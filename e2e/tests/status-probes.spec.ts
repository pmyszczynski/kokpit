import { expect, test } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";

const fixtures = schemaV2Fixtures([
  { name: "Saved service", url: "http://localhost:32400" },
]);

test.beforeEach(async ({ request }) => {
  const response = await request.patch("/api/settings", {
    data: { ...fixtures, groups: [], bookmarks: [], appearance: { theme: "dark" } },
  });
  expect(response.status()).toBe(200);
});

test("status probes use a saved service and update its tile", async ({ page, request }) => {
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
