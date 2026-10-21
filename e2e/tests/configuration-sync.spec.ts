import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse, stringify } from "yaml";
import { schemaV2Fixtures } from "../helpers/schema-v2";

const fixture = schemaV2Fixtures([
  { name: "First service", url: "http://localhost:9876", group: "Servers" },
  { name: "Second service", url: "http://localhost:9877", group: "Servers" },
]);
function runtimePath() {
  const path = process.env.KOKPIT_E2E_RUNTIME_CONFIG_PATH;
  if (!path) throw new Error("Missing isolated E2E runtime configuration");
  return resolve(path);
}
async function restoreSource(request: APIRequestContext, source: string) {
  await writeFile(runtimePath(), source);
  // Publication requires two stable observations after a direct filesystem edit.
  await expect.poll(async () => (await request.get("/api/settings")).status()).toBe(200);
}

test.beforeEach(async ({ request }) => {
  expect((await request.patch("/api/settings", { data: {
    ...fixture, groups: [{ name: "Servers" }], bookmarks: [], appearance: { theme: "dark" },
  } })).status()).toBe(200);
});

test("two independent browsers receive external service/order/bookmark and actual appearance updates", async ({ page, browser, request }) => {
  const second = await browser.newContext({ baseURL: "http://localhost:3000" });
  const other = await second.newPage();
  const original = await readFile(runtimePath(), "utf8");
  try {
    await page.goto("/"); await other.goto("/");
    await expect(page.locator(".service-tile__name")).toHaveText(["First service", "Second service"]);
    const next = parse(original);
    next.services[0].name = "Renamed externally";
    next.service_tiles.reverse();
    next.bookmarks = [{ name: "External bookmarks", links: [{ name: "Docs", url: "https://example.com" }] }];
    next.appearance = { theme: "light", custom_css: ".service-tile__name { color: rgb(1, 2, 3); }", background: { color: "#123456", blur: 7 }, card_blur: 6 };
    await writeFile(runtimePath(), stringify(next));
    for (const target of [page, other]) {
      await expect(target.locator(".service-tile__name")).toHaveText(["Second service", "Renamed externally"]);
      await expect(target.getByText("External bookmarks", { exact: true })).toBeVisible();
      await expect(target.locator("html")).toHaveAttribute("data-theme", "light");
      await expect(target.locator(".service-tile__name").first()).toHaveCSS("color", "rgb(1, 2, 3)");
      await expect.poll(() => target.locator("body").evaluate((body) => body.style.getPropertyValue("--app-bg-color"))).toBe("#123456");
      await expect.poll(() => target.locator("body").evaluate((body) => body.style.getPropertyValue("--card-blur"))).toBe("6px");
    }
    next.appearance = { theme: "oled" }; next.service_tiles.pop(); next.bookmarks = [];
    await writeFile(runtimePath(), stringify(next));
    for (const target of [page, other]) {
      await expect(target.locator(".service-tile__name")).toHaveText(["Second service"]);
      await expect(target.locator("html")).toHaveAttribute("data-theme", "oled");
      await expect(target.locator("#kokpit-custom-css")).toHaveText("");
      await expect.poll(() => target.locator("body").evaluate((body) => body.style.getPropertyValue("--app-bg-color"))).toBe("");
      await expect.poll(() => target.locator("body").evaluate((body) => body.style.getPropertyValue("--card-blur"))).toBe("");
      await expect(target.getByText("External bookmarks", { exact: true })).toHaveCount(0);
    }
  } finally { await second.close(); await restoreSource(request, original); }
});

test("comment-only source edits preserve a dirty settings baseline and theme preview", async ({ page, request }) => {
  const original = await readFile(runtimePath(), "utf8");
  try {
    await page.goto("/settings");
    await page.getByRole("button", { name: "light", exact: true }).click();
    await page.getByLabel("Custom CSS").fill(".draft-that-must-stay {} ");
    await writeFile(runtimePath(), `${original}\n# operator-owned annotation\n`);
    await expect(page.getByRole("alert").filter({ hasText: "settings.yaml changed on disk" })).toBeVisible();
    await expect(page.getByLabel("Custom CSS")).toHaveValue(".draft-that-must-stay {} ");
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  } finally { await restoreSource(request, original); }
});

test("temporary invalid YAML releases native modal blocking for Retry and restores the live draft after repair", async ({ page, request }) => {
  const original = await readFile(runtimePath(), "utf8");
  try {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Services", exact: true }).click();
    await page.getByRole("button", { name: "+ Add Service", exact: true }).click();
    await page.getByLabel("Name *", { exact: true }).fill("Retained modal draft");
    await writeFile(runtimePath(), "auth: [temporarily invalid\n");
    const retry = page.getByRole("button", { name: "Retry", exact: true });
    await expect(retry).toBeVisible();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await retry.click();
    await expect(retry).toBeFocused();
    await writeFile(runtimePath(), original);
    await expect(page.getByLabel("Name *", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Name *", { exact: true })).toHaveValue("Retained modal draft");
    await expect(page.locator("dialog[open]")).toHaveCount(1);
  } finally { await restoreSource(request, original); }
});
