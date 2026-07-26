import { test, expect, type Page } from "@playwright/test";

/**
 * Broken-widget feedback: when a service's `widget.config` fails that
 * widget's Zod schema, the tile no longer silently degrades to a plain link —
 * it shows a warning badge instead of the widget area. With
 * KOKPIT_AUTH_DISABLED (this test server's config) the protected layout
 * grants `canEdit: true` even in view mode, so the badge is interactive there
 * too: clicking it opens the service's edit dialog, entering edit mode along
 * the way (see EditModeProvider's requestServiceEdit/pendingEditService).
 *
 * Mutates shared state via PATCH /api/settings like the other spec files —
 * playwright.config.ts pins workers: 1 so these writes never race.
 */

const SERVICES = [
  {
    name: "Sonarr",
    url: "http://localhost:8001",
    // sonarr-queue's schema requires both `url` and `api_key`; `api_key` is
    // missing here, so the config fails validation.
    widget: { type: "sonarr-queue", config: { url: "http://localhost:8001" } },
  },
  {
    name: "Prowlarr",
    url: "http://localhost:8002",
    // The control that matters: a widget whose config PASSES its schema. Its
    // data fetch will fail (nothing is listening on that port), which is the
    // point — a runtime fetch failure is a different condition from a config
    // failure and must not raise the badge.
    widget: {
      type: "prowlarr-stats",
      config: { url: "http://localhost:8002", api_key: "test-key" },
    },
  },
  { name: "Grafana", url: "http://localhost:3001" },
];

function sonarrTile(page: Page) {
  return page
    .locator(".service-tile")
    .filter({ has: page.locator('.service-tile__name:text-is("Sonarr")') });
}

test.describe("broken-widget feedback", () => {
  test.beforeAll(async ({ request }) => {
    // Warm up dev-mode route compilation before the first real test.
    await request.get("/").catch(() => null);
  });

  test.beforeEach(async ({ request }) => {
    const res = await request.patch("/api/settings", {
      data: { services: SERVICES, groups: [], bookmarks: [] },
    });
    expect(res.ok(), `Settings patch failed: ${res.status()}`).toBeTruthy();
  });

  test("shows a warning badge instead of the widget when its config is invalid", async ({
    page,
  }) => {
    await page.goto("/");
    const tile = sonarrTile(page);
    await expect(tile).toBeVisible();

    const badge = tile.locator(".tile-widget-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("data-widget-config-invalid", "true");
    await expect(badge).toHaveAttribute(
      "aria-label",
      "Widget configuration error: Sonarr"
    );

    // No silent link-degrade, and this is deliberately NOT the unrelated
    // "unknown widget type" error box (that's a different failure mode).
    await expect(tile.locator(".service-tile__widget")).toHaveCount(0);
    await expect(tile.locator(".widget-error")).toHaveCount(0);

    // A widget-less sibling keeps rendering as a plain link.
    const grafanaTile = page
      .locator(".service-tile")
      .filter({ has: page.locator('.service-tile__name:text-is("Grafana")') });
    await expect(grafanaTile.locator(".tile-widget-badge")).toHaveCount(0);

    // The control that actually guards against false positives: a widget
    // whose config is VALID gets no badge, even though its data fetch fails
    // against a port with nothing behind it. A broken connection and a broken
    // config are different problems and must look different.
    const prowlarrTile = page
      .locator(".service-tile")
      .filter({ has: page.locator('.service-tile__name:text-is("Prowlarr")') });
    await expect(prowlarrTile.locator(".service-tile__widget")).toHaveCount(1);
    await expect(prowlarrTile.locator(".tile-widget-badge")).toHaveCount(0);
  });

  test("clicking the badge opens the service's edit dialog", async ({ page }) => {
    await page.goto("/");
    const badge = sonarrTile(page).locator(".tile-widget-badge");
    await expect(badge).toBeVisible();

    await badge.click();

    // requestServiceEdit entered edit mode to mount the dialog.
    await expect(page.locator(".edit-bar")).toBeVisible();

    const dialog = page.locator("dialog.service-form-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Edit Service")).toBeVisible();
    await expect(dialog.getByLabel("Name *")).toHaveValue("Sonarr");
  });
});
