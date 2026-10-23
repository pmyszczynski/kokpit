import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { schemaV2Fixtures } from "../helpers/schema-v2";

const FIXTURE = schemaV2Fixtures([{
  name: "Unraid",
  url: "http://192.168.1.10",
  description: "Array health and storage",
  widget: { type: "unraid-stats", config: { url: "http://192.168.1.10", api_key: "preview-only-key" } },
}]);

async function configure(request: APIRequestContext, theme = "dark", custom_css = "") {
  expect((await request.patch("/api/settings", { data: {
    ...FIXTURE, groups: [], bookmarks: [], appearance: { theme, custom_css },
  } })).ok()).toBe(true);
}

async function openEditor(page: Page) {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Services", exact: true }).click();
  await page.locator(".service-table tbody tr").filter({ hasText: "Unraid" }).getByRole("button", { name: "Edit", exact: true }).click();
  return page.getByRole("dialog", { name: "Edit Service" });
}

test("Unraid setup guide fits alongside its fields in every theme", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  for (const theme of ["dark", "light", "oled", "high-contrast"]) {
    await configure(request, theme);
    const dialog = await openEditor(page);
    const guide = dialog.getByRole("complementary", { name: "Connect Unraid" });
    await expect(guide.getByRole("listitem")).toHaveCount(4);
    await expect(dialog.getByLabel("URL *", { exact: true })).toHaveAccessibleDescription(/adds \/graphql automatically/);
    await expect(dialog.getByLabel("URL", { exact: true })).toHaveAccessibleDescription(/Integration section above/);
    await expect(dialog.getByLabel("API Key *", { exact: true })).toHaveAccessibleDescription(/Paste only the key/);
    await expect(dialog.getByLabel("API Key *", { exact: true })).toHaveValue("");
    await expect(dialog.getByLabel("Tile type", { exact: true })).toHaveCSS("background-repeat", "no-repeat");
    const guideBox = (await guide.boundingBox())!;
    const fieldsBox = (await dialog.locator("fieldset").boundingBox())!;
    expect(guideBox.x).toBeGreaterThan(fieldsBox.x + fieldsBox.width);
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
    if (theme === "dark" || theme === "light") {
      await testInfo.attach(`unraid-setup-${theme}`, {
        body: await dialog.screenshot({
          path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/unraid-setup-${theme}.png` : undefined,
        }), contentType: "image/png",
      });
    }
  }
});

test("guide follows the integration and editing guidance preserves the saved key", async ({ page, request }) => {
  await configure(request);
  const dialog = await openEditor(page);
  const guide = dialog.getByRole("complementary", { name: "Connect Unraid" });
  const troubleshooting = guide.locator("summary");
  await troubleshooting.focus();
  await page.keyboard.press("Enter");
  await expect(guide.getByText("Unauthorized or permission denied", { exact: true })).toBeVisible();
  // A plain tile can still have an Unraid connection and needs the same guide.
  await dialog.getByLabel("Tile type", { exact: true }).selectOption("");
  await expect(guide).toBeVisible();
  await dialog.getByLabel("Tile type", { exact: true }).selectOption("unraid-stats");
  await dialog.getByLabel("Name *", { exact: true }).fill("Storage server");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  const settings = await (await request.get("/api/settings")).json();
  expect(settings.services[0].name).toBe("Storage server");
  expect(settings.services[0].integration.config.api_key).toEqual({
    __kokpit_widget_secret_reference__: expect.stringMatching(/^__KOKPIT_WIDGET_SECRET_REF__:/),
  });
  const runtimeConfigPath = process.env.KOKPIT_E2E_RUNTIME_CONFIG_PATH;
  if (!runtimeConfigPath) throw new Error("Missing isolated E2E runtime configuration");
  const persisted = parse(await readFile(runtimeConfigPath, "utf8"));
  expect(persisted.services[0].integration.config.api_key).toBe("preview-only-key");
  // Reopening still recognizes the retained credential, without revealing it.
  await page.locator(".service-table tbody tr").filter({ hasText: "Storage server" }).getByRole("button", { name: "Edit", exact: true }).click();
  await expect(dialog.getByLabel("API Key *", { exact: true })).toHaveAttribute("placeholder", /saved/i);
  await dialog.getByLabel("Integration", { exact: true }).selectOption("");
  await expect(guide).toHaveCount(0);
});

test("mobile guide scrolls with the form and accepts custom CSS", async ({ page, request }, testInfo) => {
  await configure(request, "dark", ".widget-setup-guide { border-radius: 13px; }");
  await page.setViewportSize({ width: 390, height: 844 });
  const dialog = await openEditor(page);
  const guide = dialog.getByRole("complementary", { name: "Connect Unraid" });
  await expect(guide).toHaveCSS("border-top-left-radius", "13px");
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await guide.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await testInfo.attach("unraid-setup-mobile", {
    body: await dialog.screenshot({
      path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/unraid-setup-mobile.png` : undefined,
    }), contentType: "image/png",
  });
  await dialog.getByLabel("Refresh interval (ms)").scrollIntoViewIfNeeded();
  await expect(dialog.getByLabel("Refresh interval (ms)")).toHaveAccessibleDescription(/30 seconds/);
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 420 });
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
});
