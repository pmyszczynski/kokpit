import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isSeq, parseDocument } from "yaml";
import { schemaV2Fixtures } from "../helpers/schema-v2";

const first = { name: "Saved service", url: "http://localhost:32400" };
const fixtures = schemaV2Fixtures([first]);

test.beforeEach(async ({ request }) => {
  const response = await request.patch("/api/settings", {
    data: { ...fixtures, groups: [], bookmarks: [], appearance: { theme: "dark" } },
  });
  expect(response.status()).toBe(200);
});

test("status checks require JSON POST and resolve a saved service", async ({ request, page }) => {
  expect((await request.get("/api/ping?url=http://localhost:32400")).status()).toBe(405);
  expect((await request.post("/api/ping", {
    headers: { "Content-Type": "text/plain" },
    data: JSON.stringify({ serviceId: fixtures.services[0].id }),
  })).status()).toBe(415);
  expect((await request.post("/api/ping", { data: { url: "http://localhost:32400" } })).status()).toBe(400);
  const status = await request.post("/api/ping", {
    data: { serviceId: fixtures.services[0].id },
  });
  expect(status.status()).toBe(200);
  expect(await status.json()).toMatchObject({ ok: true });
  await page.goto("/");
  await expect(page.getByLabel("Online", { exact: true })).toBeVisible();
});

test("settings conflict preserves the other editor's services and reloads a fresh draft", async ({ page, request }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Services", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: first.name })).toBeVisible();

  const updated = schemaV2Fixtures([first, { name: "Added elsewhere", url: "http://localhost:32400/other" }]);
  expect((await request.patch("/api/settings", { data: updated })).status()).toBe(200);
  const rejectedSave = page.waitForResponse((response) =>
    response.url().endsWith("/api/settings") && response.request().method() === "PATCH"
  );
  await page.getByRole("row").filter({ hasText: first.name }).getByRole("button", { name: "Delete", exact: true }).click();
  expect((await rejectedSave).status()).toBe(409);
  await expect(page.getByRole("alert").filter({ hasText: "changed while you were editing" })).toBeVisible();
  expect((await (await request.get("/api/settings")).json()).services.map((service: { name: string }) => service.name))
    .toEqual([first.name, "Added elsewhere"]);

  await expect(page.getByRole("button", { name: "+ Add Service", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Appearance", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Reload settings" }).click();
  await page.getByRole("button", { name: "Services", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Added elsewhere" })).toBeVisible();
  const acceptedSave = page.waitForResponse((response) =>
    response.url().endsWith("/api/settings") && response.request().method() === "PATCH"
  );
  await page.getByRole("row").filter({ hasText: first.name }).getByRole("button", { name: "Delete", exact: true }).click();
  expect((await acceptedSave).status()).toBe(200);
  expect((await (await request.get("/api/settings")).json()).services.map((service: { name: string }) => service.name))
    .toEqual(["Added elsewhere"]);
});

test("settings detects a comment-only external edit before saving", async ({ page, request }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Services", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: first.name })).toBeVisible();
  const initial = await request.get("/api/settings");
  const revision = initial.headers()["x-config-revision"];
  const configPath = resolve("e2e/fixtures/settings.yaml");
  const document = parseDocument(await readFile(configPath, "utf-8"));
  const services = document.get("services", true);
  if (!isSeq(services)) throw new Error("Expected a services sequence in the test fixture");
  services.commentBefore = " Keep this external editor note";
  const externalSource = document.toString();
  await writeFile(configPath, externalSource);

  // Wait until the watcher has published the edit, beyond its temporary dirty state.
  await expect.poll(async () => {
    const response = await request.get("/api/settings");
    return response.status() === 200 && response.headers()["x-config-revision"] !== revision;
  }).toBe(true);
  const rejectedSave = page.waitForResponse((response) =>
    response.url().endsWith("/api/settings") && response.request().method() === "PATCH"
  );
  await page.getByRole("row").filter({ hasText: first.name }).getByRole("button", { name: "Delete", exact: true }).click();
  expect((await rejectedSave).status()).toBe(409);
  await expect(page.getByRole("alert").filter({ hasText: "changed while you were editing" })).toBeVisible();
  expect(await readFile(configPath, "utf-8")).toBe(externalSource);
});
