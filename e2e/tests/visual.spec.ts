import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_MOCK_STATE } from "../helpers/mock-plex-server";
import {
  FIXTURE_SERVICES,
  FIXTURE_GROUPS,
  FIXTURE_BOOKMARKS,
} from "../helpers/fixture-services";

const MOCK = "http://localhost:32400";

/**
 * Visual regression: catches CSS/layout/theme regressions that DOM assertions
 * can't see. Screenshots are scoped to `.shell` / `.settings-panel` rather than
 * the full viewport to avoid scrollbar/height flakiness.
 *
 * The `.status-dot` element polls a live ping endpoint and is masked in every
 * screenshot since its online/offline result isn't deterministic in CI.
 */
test.describe("visual regression", () => {
  test.beforeEach(async ({ request }) => {
    await request.post(`${MOCK}/__control`, { data: DEFAULT_MOCK_STATE });
    await request.patch("/api/settings", {
      data: {
        services: FIXTURE_SERVICES,
        groups: FIXTURE_GROUPS,
        bookmarks: FIXTURE_BOOKMARKS,
        appearance: { theme: "dark", custom_css: undefined },
      },
    });
  });

  async function waitForDashboardReady(page: Page) {
    await expect(
      page.locator(".service-tile__letter-fallback, .service-tile__icon").first()
    ).toBeVisible();
    await expect(page.locator(".plex-widget__value").first()).toBeVisible();
    // Bookmark tiles use inline data: URI icons (no favicon fetch), so once a
    // link is visible the whole bookmark section has painted — no async icon
    // error-swap can race the screenshot.
    await expect(page.locator(".bookmark-tile__link").first()).toBeVisible();
  }

  for (const theme of ["dark", "light", "oled", "high-contrast"] as const) {
    test(`dashboard renders correctly in ${theme} theme`, async ({ page, request }) => {
      await request.patch("/api/settings", { data: { appearance: { theme } } });
      await page.goto("/");
      await waitForDashboardReady(page);

      await expect(page.locator(".shell")).toHaveScreenshot(`dashboard-${theme}.png`, {
        mask: [page.locator(".status-dot")],
      });
    });
  }

  test("dashboard shows widget error state", async ({ page, request }) => {
    await request.post(`${MOCK}/__control`, {
      data: { ...DEFAULT_MOCK_STATE, error: 503 },
    });
    await page.goto("/");
    await expect(page.locator(".widget-error")).toBeVisible();

    await expect(page.locator(".shell")).toHaveScreenshot("dashboard-widget-error.png", {
      mask: [page.locator(".status-dot")],
    });
  });

  test("custom CSS override renders correctly", async ({ page, request }) => {
    await request.patch("/api/settings", {
      data: {
        appearance: {
          theme: "dark",
          custom_css: ".service-tile { border-radius: 0 !important; border-color: #ff00aa !important; }",
        },
      },
    });
    await page.goto("/");
    await waitForDashboardReady(page);

    await expect(page.locator(".shell")).toHaveScreenshot("dashboard-custom-css.png", {
      mask: [page.locator(".status-dot")],
    });
  });

  test("settings panel: appearance tab", async ({ page }) => {
    await page.goto("/settings");
    await page.click("button.settings-tab:has-text('Appearance')");
    await expect(page.locator(".settings-section__title")).toHaveText("Appearance");

    await expect(page.locator(".settings-panel")).toHaveScreenshot("settings-appearance.png");
  });

  test("settings panel: layout tab", async ({ page }) => {
    await page.goto("/settings");
    await page.click("button.settings-tab:has-text('Layout')");
    await expect(page.locator(".settings-section__title")).toHaveText("Layout");

    await expect(page.locator(".settings-panel")).toHaveScreenshot("settings-layout.png");
  });

  test("settings panel: services tab", async ({ page }) => {
    await page.goto("/settings");
    await page.click("button.settings-tab:has-text('Services')");
    await expect(page.locator(".settings-section__title")).toHaveText("Services");

    await expect(page.locator(".settings-panel")).toHaveScreenshot("settings-services.png");
  });

  test("settings panel: groups tab", async ({ page }) => {
    await page.goto("/settings");
    await page.click("button.settings-tab:has-text('Groups')");
    await expect(page.locator(".settings-section__title")).toHaveText("Groups");

    await expect(page.locator(".settings-panel")).toHaveScreenshot("settings-groups.png");
  });

  test("settings panel: bookmarks tab", async ({ page }) => {
    await page.goto("/settings");
    await page.click("button.settings-tab:has-text('Bookmarks')");
    await expect(page.locator(".settings-section__title")).toHaveText("Bookmarks");

    await expect(page.locator(".settings-panel")).toHaveScreenshot("settings-bookmarks.png");
  });

  test("add-service dialog renders correctly", async ({ page }) => {
    await page.goto("/settings");
    await page.click("button.settings-tab:has-text('Services')");
    await page.click("button:has-text('+ Add Service')");
    await expect(page.locator("dialog.service-form-dialog")).toBeVisible();

    await expect(page.locator("dialog.service-form-dialog")).toHaveScreenshot(
      "settings-add-service-dialog.png"
    );
  });
});
