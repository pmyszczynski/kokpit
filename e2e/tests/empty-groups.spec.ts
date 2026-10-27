import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { schemaV2Fixtures } from "../helpers/schema-v2";

const fixtures = schemaV2Fixtures([{ name: "Source", url: "https://example.com", group: "Media" }]);
const group = (page: Page, name: string) => page.locator(".service-group").filter({
  has: page.getByRole("button", { name, exact: true }),
});
const ghost = (page: Page, name = "Empty") => group(page, name).locator(".dashboard-add-tile--empty");

async function enterEdit(page: Page) {
  await page.goto("/");
  await expect(ghost(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Edit dashboard" }).click();
  await expect(ghost(page)).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  expect((await request.patch("/api/settings", { data: {
    ...fixtures, groups: [{ name: "Media" }, { name: "Empty" }], bookmarks: [],
    appearance: { theme: "dark", custom_css: "" },
  } })).ok()).toBe(true);
});

test("keyboard add targets the empty group, stages once, and persists only on explicit save", async ({ page, request }) => {
  const before = await (await request.get("/api/settings")).json();
  const writes: string[] = [];
  page.on("request", request => {
    if (request.url().endsWith("/api/settings") && request.method() === "PATCH") writes.push(request.postData()!);
  });
  await enterEdit(page);
  await expect(ghost(page)).toHaveAccessibleName("Add tile to Empty");
  await expect(ghost(page)).toHaveAccessibleDescription("This group is empty");
  await ghost(page).focus(); await page.keyboard.press("Enter");
  const picker = page.getByRole("dialog", { name: "Add tile to Empty", exact: true });
  await picker.getByRole("button", { name: /Blank service/ }).click();
  const form = page.getByRole("dialog", { name: "Add Service", exact: true });
  await expect(form.getByLabel("Group", { exact: true })).toHaveValue("Empty");
  await form.getByLabel("Name *", { exact: true }).fill("First in group");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(ghost(page)).toHaveCount(0);
  await expect(group(page, "Empty").locator(".service-tile__name")).toHaveText("First in group");
  expect(writes).toHaveLength(0);
  expect(await (await request.get("/api/settings")).json()).toEqual(before);
  await page.getByRole("button", { name: "Save & exit", exact: true }).click();
  await expect(page.locator(".edit-bar")).toBeHidden();
  expect(writes).toHaveLength(1);
  const saved = await (await request.get("/api/settings")).json();
  expect(saved.services).toHaveLength(before.services.length + 1);
  expect(saved.service_tiles.at(-1)).toMatchObject({ group: "Empty", service_id: saved.services.at(-1).id });
  expect(await readFile(process.env.KOKPIT_E2E_RUNTIME_CONFIG_PATH!, "utf8")).toContain("group: Empty");
  await page.reload();
  await expect(group(page, "Empty").locator(".service-tile__name")).toHaveText("First in group");
  await expect(page.locator(".dashboard-add-tile--empty")).toHaveCount(0);
});

test("cancelling and discarding bookmark additions leave the empty group intact", async ({ page, request }) => {
  const before = await (await request.get("/api/settings")).json();
  await enterEdit(page);
  await ghost(page).click();
  const picker = page.getByRole("dialog", { name: "Add tile to Empty", exact: true });
  await picker.getByRole("button", { name: "Close", exact: true }).click();
  await expect(ghost(page)).toBeFocused();
  await expect(page.locator(".edit-bar__status")).toHaveText("No changes");
  await ghost(page).click();
  await picker.getByRole("button", { name: /Bookmark group/ }).click();
  const form = page.getByRole("dialog", { name: "Add Bookmark Group", exact: true });
  await expect(form.getByLabel("Placement group", { exact: true })).toHaveValue("Empty");
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(ghost(page)).toBeVisible();
  await expect(page.locator(".edit-bar__status")).toHaveText("No changes");
  await ghost(page).click();
  await picker.getByRole("button", { name: /Bookmark group/ }).click();
  await form.getByLabel("Name *", { exact: true }).fill("Links");
  await form.getByLabel("Link 1 name", { exact: true }).fill("Docs");
  await form.getByLabel("Link 1 URL", { exact: true }).fill("https://example.com");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(group(page, "Empty").locator(".bookmark-tile")).toBeVisible();
  await expect(ghost(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  expect(await (await request.get("/api/settings")).json()).toEqual(before);
  await page.getByRole("button", { name: "Edit dashboard" }).click();
  await expect(ghost(page)).toBeVisible();
});

test("dragging onto the ghost fills its group and exposes the newly emptied group", async ({ page, request }) => {
  const before = await (await request.get("/api/settings")).json();
  await enterEdit(page);
  const handle = await page.getByRole("button", { name: "Reorder Source", exact: true }).boundingBox();
  const target = await ghost(page).boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 20, handle!.y + 20, { steps: 5 });
  await expect(page.locator(".tile-drag-overlay")).toBeVisible();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect(group(page, "Empty").locator(".service-tile__name")).toHaveText("Source");
  await expect(ghost(page)).toHaveCount(0);
  await expect(ghost(page, "Media")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await (await request.get("/api/settings")).json()).toEqual(before);
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page.getByRole("button", { name: "Edit dashboard" }).click();
  await expect(ghost(page)).toBeVisible();
  await expect(ghost(page, "Media")).toHaveCount(0);
});

test("collapsed empty groups retain their collapse state", async ({ page, request }) => {
  expect((await request.patch("/api/settings", { data: { groups: [{ name: "Media" }, { name: "Empty" }, { name: "Collapsed", collapsed: true }] } })).ok()).toBe(true);
  await enterEdit(page);
  const collapsed = group(page, "Collapsed");
  await expect(collapsed.getByRole("button", { name: "Collapsed", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(ghost(page, "Collapsed")).toBeHidden();
  await collapsed.getByRole("button", { name: "Collapsed", exact: true }).click();
  await expect(ghost(page, "Collapsed")).toBeVisible();
  await expect(page.locator(".edit-bar__status")).toHaveText("No changes");
});

test("ghosts fit mobile and desktop in every theme with readable text and keyboard focus", async ({ page, request }, testInfo) => {
  for (const theme of ["dark", "light", "oled", "high-contrast"]) {
    expect((await request.patch("/api/settings", { data: { appearance: { theme, custom_css: "" } } })).ok()).toBe(true);
    for (const width of [1108, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await enterEdit(page);
      const tile = ghost(page);
      await page.keyboard.press("Tab");
      await tile.focus();
      await expect(tile).toHaveCSS("outline-style", "solid");
      const result = await tile.evaluate(element => {
        const style = getComputedStyle(element); const box = element.getBoundingClientRect();
        const luminance = (color: string) => {
          const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(value => Number(value) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        const background = luminance(style.backgroundColor);
        const ratios = [...element.querySelectorAll(".dashboard-add-tile__label, .dashboard-add-tile__hint")].map(text => {
          const foreground = luminance(getComputedStyle(text).color);
          return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        });
        return { width: box.width, height: box.height, fits: box.left >= 0 && box.right <= innerWidth, ratios };
      });
      expect(result).toMatchObject({ width: 340, height: 60, fits: true });
      expect(result.ratios.every(ratio => ratio >= 4.5)).toBe(true);
      if (width === 1108) await testInfo.attach(`empty-group-${theme}`, { body: await group(page, "Empty").screenshot({ path: process.env.KOKPIT_EMPTY_GROUP_PREVIEW_DIR ? `${process.env.KOKPIT_EMPTY_GROUP_PREVIEW_DIR}/empty-group-${theme}.png` : undefined }), contentType: "image/png" });
      await page.getByRole("button", { name: "Discard", exact: true }).click();
    }
  }
});

test("custom CSS overrides the ghost tile without important declarations", async ({ page, request }) => {
  expect((await request.patch("/api/settings", { data: { appearance: { theme: "dark", custom_css: ".dashboard-add-tile--empty { background: rgb(1, 2, 3); padding: 6px; }" } } })).ok()).toBe(true);
  await enterEdit(page);
  await expect(ghost(page)).toHaveCSS("background-color", "rgb(1, 2, 3)");
  await expect(ghost(page)).toHaveCSS("padding-top", "6px");
});
