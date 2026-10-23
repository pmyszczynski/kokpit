import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { schemaV2Fixtures } from "../helpers/schema-v2";

test("Sonarr guide follows Calendar and Queue while preserving their connection", async ({ page, request }, testInfo) => {
  const fixture = schemaV2Fixtures([{
    name: "Sonarr", url: "http://sonarr.local:8989/",
    widget: { type: "sonarr-calendar", config: { url: "http://sonarr.local:8989/", api_key: "sonarr-preview-key" } },
  }]);
  expect((await request.patch("/api/settings", { data: {
    ...fixture, groups: [], bookmarks: [], appearance: { theme: "dark" },
  } })).ok()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto("/settings");
  await page.getByRole("button", { name: "Services", exact: true }).click();
  const openEditor = () => page.locator(".service-table tbody tr").filter({ hasText: "Sonarr" }).getByRole("button", { name: "Edit", exact: true }).click();
  await openEditor();
  const dialog = page.getByRole("dialog", { name: "Edit Service" });
  const guide = dialog.getByRole("complementary", { name: "Connect Sonarr" });
  await expect(guide.getByRole("link", { name: "Official documentation" })).toHaveAttribute("href", "https://wiki.servarr.com/sonarr/settings#general");
  await expect(dialog.getByLabel("URL *", { exact: true })).toHaveAccessibleDescription(/end it with a slash/);
  await expect(dialog.getByLabel("API Key *", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Days ahead", { exact: true })).toHaveAccessibleDescription(/00:00 UTC.*7 days/);
  await expect(dialog.getByLabel("Refresh interval (ms)")).toHaveAccessibleDescription(/60 seconds/);
  await dialog.getByLabel("Days ahead", { exact: true }).fill("9");
  const capture = async (name: string) => {
    await dialog.locator(".service-form__body").evaluate(node => { node.scrollTop = 0; });
    await testInfo.attach(name, {
      body: await dialog.screenshot({ path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/${name}.png` : undefined }),
      contentType: "image/png",
    });
  };
  await capture("sonarr-calendar-setup-dark");
  await dialog.getByLabel("Tile type", { exact: true }).selectOption("sonarr-queue");
  await expect(guide).toBeVisible();
  await expect(dialog.getByLabel("Days ahead", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Footprint", { exact: true })).toHaveAccessibleDescription(/25 queue entries/);
  await expect(dialog.getByLabel("Refresh interval (ms)")).toHaveAccessibleDescription(/15 seconds/);
  await capture("sonarr-queue-setup-dark");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await guide.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeInViewport();
  await capture("sonarr-setup-mobile");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  const runtimeConfigPath = process.env.KOKPIT_E2E_RUNTIME_CONFIG_PATH;
  if (!runtimeConfigPath) throw new Error("Missing isolated E2E runtime configuration");
  const persisted = parse(await readFile(runtimeConfigPath, "utf8"));
  expect(persisted.services[0].integration.config.api_key).toBe("sonarr-preview-key");
  expect(persisted.service_tiles[0].widget.type).toBe("sonarr-queue");
  expect(persisted.service_tiles[0].widget.config?.days).toBeUndefined();
  await page.setViewportSize({ width: 1440, height: 1200 });
  expect((await request.patch("/api/settings", { data: { appearance: { theme: "light" } } })).ok()).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Services", exact: true }).click();
  await openEditor();
  await expect(guide).toBeVisible();
  await expect(dialog.getByLabel("API Key *", { exact: true })).toHaveAttribute("placeholder", /saved/i);
  await capture("sonarr-queue-setup-light");
});
