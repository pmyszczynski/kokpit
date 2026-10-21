import { test, expect } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";

test.describe("empty dashboard", () => {
  test.beforeEach(async ({ request }) => {
    const response = await request.patch("/api/settings", {
      data: { services: [], service_tiles: [], groups: [], bookmarks: [], appearance: { theme: "dark", custom_css: "" } },
    });
    expect(response.ok()).toBeTruthy();
  });

  test("keyboard entry stages the first service, then explicit save survives reload", async ({ page, request }) => {
    const writes: string[] = [];
    page.on("request", request => { if (request.url().endsWith("/api/settings") && request.method() === "PATCH") writes.push(request.postData()!); });
    await page.goto("/");
    const action = page.getByRole("button", { name: "Add your first service" });
    await action.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Add Service", exact: true });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await dialog.getByLabel("Name *", { exact: true }).fill("First service");
    await dialog.getByLabel("URL", { exact: true }).fill("http://localhost:3001");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(writes).toHaveLength(0);
    const staged = await (await request.get("/api/settings")).json();
    expect(staged.services).toHaveLength(0);
    await page.getByRole("button", { name: "Save & exit" }).click();
    await expect(page.locator(".edit-bar")).toBeHidden();
    expect(writes).toHaveLength(1);
    await page.reload();
    await expect(page.locator(".service-tile__name", { hasText: "First service" })).toBeVisible();
    await expect(page.locator(".empty-dashboard")).toHaveCount(0);
  });

  test("closing the picker and cancelling the form do not reopen or change settings", async ({ page, request }) => {
    const before = await (await request.get("/api/settings")).json();
    const writes: string[] = [];
    page.on("request", request => { if (request.url().endsWith("/api/settings") && request.method() === "PATCH") writes.push(request.postData()!); });
    await page.goto("/");
    await page.getByRole("button", { name: "More tile options" }).click();
    const picker = page.getByRole("dialog", { name: "Add tile", exact: true });
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: "Close", exact: true }).click();
    await expect(picker).toBeHidden();
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await page.getByRole("button", { name: "Add your first service" }).click();
    const form = page.getByRole("dialog", { name: "Add Service", exact: true });
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(form).toBeHidden();
    await page.getByRole("button", { name: "Save & exit" }).click();
    await expect(page.getByRole("button", { name: "Add your first service" })).toBeVisible();
    expect(await (await request.get("/api/settings")).json()).toEqual(before);
    expect(writes).toHaveLength(0);
  });

  test("existing catalog entries survive adding and discarding an unplaced dashboard draft", async ({ page, request }) => {
    const fixture = schemaV2Fixtures([{ name: "Saved only", url: "http://localhost:9000" }]);
    const seeded = await request.patch("/api/settings", { data: { services: fixture.services, service_tiles: [], groups: [{ name: "Empty group" }] } });
    expect(seeded.ok()).toBeTruthy();
    const before = await seeded.json();
    const writes: string[] = [];
    page.on("request", request => { if (request.url().endsWith("/api/settings") && request.method() === "PATCH") writes.push(request.postData()!); });
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Manage saved services" })).toHaveAttribute("href", "/settings");
    await page.getByRole("button", { name: "Add a tile", exact: true }).click();
    await page.getByRole("dialog", { name: "Add tile", exact: true }).getByRole("button", { name: /Blank service/ }).click();
    const form = page.getByRole("dialog", { name: "Add Service", exact: true });
    await form.getByLabel("Name *", { exact: true }).fill("Discarded service");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await page.reload();
    const after = await (await request.get("/api/settings")).json();
    expect(after.services).toEqual(before.services);
    expect(after.service_tiles).toEqual([]);
    await expect(page.getByRole("button", { name: "Add a tile", exact: true })).toBeVisible();
    expect(writes).toHaveLength(0);
  });

  for (const choice of ["Bookmark group", "Plex"]) {
    test(`offers the existing ${choice} form through more tile options`, async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "More tile options" }).click();
      await page.getByRole("dialog", { name: "Add tile", exact: true }).getByRole("button", { name: new RegExp(`^${choice}`) }).click();
      const form = page.getByRole("dialog", { name: choice === "Bookmark group" ? "Add Bookmark Group" : "Add Service", exact: true });
      await expect(form).toBeVisible();
      if (choice === "Plex") await expect(form.getByLabel("Tile type", { exact: true })).toHaveValue("plex");
      await form.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Discard", exact: true }).click();
      await expect(page.locator(".empty-dashboard")).toBeVisible();
    });
  }

  for (const theme of ["dark", "light", "oled", "high-contrast"]) {
    test(`fits a mobile screen in the ${theme} theme`, async ({ page, request }) => {
      expect((await request.patch("/api/settings", { data: { appearance: { theme, custom_css: "" } } })).ok()).toBeTruthy();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      const card = page.locator(".empty-dashboard");
      await expect(card).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const bounds = await card.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
      const colors = await card.evaluate(element => ({ surface: getComputedStyle(element).backgroundColor, text: getComputedStyle(element).color }));
      expect(colors.surface).not.toBe("rgba(0, 0, 0, 0)");
      expect(colors.text).not.toBe(colors.surface);
      // The global reset must not override this component's layered spacing.
      await expect(card).toHaveCSS("padding-top", "20px");
      await expect(card).toHaveCSS("margin-top", "32px");
      await expect(card.locator("h1")).toHaveCSS("margin-bottom", "16px");
      await expect(card.locator(".empty-dashboard__actions")).toHaveCSS("margin-top", "20px");
      await test.info().attach(`empty-${theme}.png`, { body: await card.screenshot({ path: process.env.KOKPIT_EMPTY_PREVIEW_DIR ? `${process.env.KOKPIT_EMPTY_PREVIEW_DIR}/empty-${theme}.png` : undefined }), contentType: "image/png" });
    });
  }

  test("custom CSS overrides the welcome card without important declarations", async ({ page, request }) => {
    expect((await request.patch("/api/settings", { data: { appearance: { theme: "dark", custom_css: ".empty-dashboard { background: rgb(1, 2, 3); }" } } })).ok()).toBeTruthy();
    await page.goto("/");
    await expect(page.locator(".empty-dashboard")).toHaveCSS("background-color", "rgb(1, 2, 3)");
  });
});
