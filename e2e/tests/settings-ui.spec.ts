import { expect, test } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";

const fixtures = schemaV2Fixtures([]);

test("bookmark dialog keeps its body scrollable on a short viewport", async ({ page, request }) => {
  const links = Array.from({ length: 8 }, (_, index) => ({
    name: `Link ${index + 1}`,
    url: `http://localhost:${9201 + index}`,
  }));
  const response = await request.patch("/api/settings", {
    data: {
      ...fixtures,
      groups: [],
      bookmarks: [{ name: "Long group", style: "list", links }],
      appearance: { theme: "dark" },
    },
  });
  expect(response.status()).toBe(200);

  await page.setViewportSize({ width: 480, height: 420 });
  await page.goto("/settings");
  await page.getByRole("button", { name: "Bookmarks", exact: true }).click();
  await page.locator(".groups-row").filter({ hasText: "Long group" })
    .getByRole("button", { name: "Edit" }).click();

  const dialog = page.locator("dialog.service-form-dialog");
  await expect(dialog).toBeVisible();
  const body = dialog.locator(".service-form__body");
  await expect.poll(() => body.evaluate((element) => element.scrollHeight - element.clientHeight))
    .toBeGreaterThan(50);
  await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
});

test("custom CSS can override settings fieldset resets", async ({ page, request }) => {
  const response = await request.patch("/api/settings", {
    data: {
      ...fixtures,
      groups: [],
      bookmarks: [],
      appearance: {
        theme: "dark",
        custom_css: ".settings-fieldset { border: 3px solid red; margin: 11px; padding: 13px; display: grid; gap: 7px; }",
      },
    },
  });
  expect(response.status()).toBe(200);

  await page.goto("/settings");
  const fieldset = page.locator(".settings-content fieldset.settings-fieldset");
  await expect(fieldset).toHaveCSS("border-top-width", "3px");
  await expect(fieldset).toHaveCSS("margin-top", "11px");
  await expect(fieldset).toHaveCSS("padding-top", "13px");
  await expect(fieldset).toHaveCSS("display", "grid");
  await expect(fieldset).toHaveCSS("gap", "7px");
});
