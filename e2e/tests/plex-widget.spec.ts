import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_MOCK_STATE } from "../helpers/mock-plex-server";
import type { MockPlexState } from "../helpers/mock-plex-server";

const MOCK = "http://localhost:32400";

/** Services list that matches the fixture settings.yaml. */
const FIXTURE_SERVICES = [
  {
    name: "Plex",
    url: "http://localhost:32400",
    widget: {
      type: "plex",
      config: {
        url: "http://localhost:32400",
        token: "test-token",
        fields: ["streams", "transcodes", "library_movies"],
      },
    },
  },
];

/**
 * Warm up Next.js route compilation before the first test.
 * In dev mode, each route is compiled on first access; this fires a few
 * cheap requests so tests don't time out waiting for the first compilation.
 */
test.beforeAll(async ({ request }) => {
  await request.get("/").catch(() => null);
  await request.get("/api/widget?type=plex&service=Plex").catch(() => null);
});

/**
 * Before each test:
 *  - Reset mock server to default state (2 streams, 1 transcode, 150 movies)
 *  - Reset settings to only the fixture Plex service (undo any changes from Test 4)
 */
test.beforeEach(async ({ request }) => {
  await request.post(`${MOCK}/__control`, { data: DEFAULT_MOCK_STATE });
  await request.patch("/api/settings", {
    data: { services: FIXTURE_SERVICES },
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the .plex-widget locator scoped to the tile whose name matches
 * exactly. Using :text-is() prevents "My Plex" from matching "Plex".
 */
function plexWidget(page: Page, name = "Plex") {
  return page
    .locator(".service-tile")
    .filter({ has: page.locator(`.service-tile__name:text-is("${name}")`) })
    .locator(".plex-widget");
}

function widgetStat(page: Page, label: string, tileName = "Plex") {
  return page
    .locator(".service-tile")
    .filter({ has: page.locator(`.service-tile__name:text-is("${tileName}")`) })
    .locator(".plex-widget__stat")
    .filter({ hasText: label })
    .locator(".plex-widget__value");
}

// ── Test 1 ───────────────────────────────────────────────────────────────────

test("widget renders data from the mock server", async ({ page }) => {
  await page.goto("/");

  // Wait for the widget to finish loading (dev-mode compilation may take a while).
  await expect(plexWidget(page)).toBeVisible();

  await expect(widgetStat(page, "Streaming")).toHaveText("2");
  await expect(widgetStat(page, "Transcoding")).toHaveText("1");
  await expect(widgetStat(page, "Movies")).toHaveText("150");
});

// ── Test 2 ───────────────────────────────────────────────────────────────────

test("widget reflects updated mock state on reload", async ({ page, request }) => {
  const updated: MockPlexState = {
    sessions: {
      size: 5,
      Metadata: [
        { TranscodeSession: {}, Session: { location: "lan" }, User: { title: "A" } },
        { TranscodeSession: {}, Session: { location: "lan" }, User: { title: "B" } },
        { TranscodeSession: {}, Session: { location: "wan" }, User: { title: "C" } },
        { Session: { location: "lan" }, User: { title: "D" } },
        { Session: { location: "lan" }, User: { title: "E" } },
      ],
    },
    sectionCounts: { "1": 150 },
    error: null,
  };

  await request.post(`${MOCK}/__control`, { data: updated });

  await page.goto("/");

  await expect(widgetStat(page, "Streaming")).toHaveText("5");
  await expect(widgetStat(page, "Transcoding")).toHaveText("3");
});

// ── Test 3 ───────────────────────────────────────────────────────────────────

test("widget shows error state when Plex returns an error", async ({ page, request }) => {
  await request.post(`${MOCK}/__control`, {
    data: { ...DEFAULT_MOCK_STATE, error: 503 },
  });

  await page.goto("/");

  // Scoped to the "Plex" tile to avoid strict-mode issues when multiple
  // tiles are present on the page.
  const tile = page
    .locator(".service-tile")
    .filter({ has: page.locator('.service-tile__name:text-is("Plex")') });
  await expect(tile.locator(".widget-error")).toBeVisible();
});

// ── Test 4 ───────────────────────────────────────────────────────────────────

test("settings form saves Plex widget config and renders the tile", async ({
  page,
}) => {
  await page.goto("/settings");

  // Navigate to the Services tab
  await page.click("button.settings-tab:has-text('Services')");

  // Open the Add Service dialog
  await page.click("button:has-text('+ Add Service')");

  // Fill in service name
  await page.fill("#sf-name", "My Plex");

  // Select the Plex widget type
  await page.selectOption("#sf-tile-type", "plex");

  // Fill widget config fields (rendered dynamically after type selection)
  await page.fill("#sf-widget-url", "http://localhost:32400");
  await page.fill("#sf-widget-token", "test-token");

  // Select display fields
  await page.getByRole("checkbox", { name: "Streaming" }).check();
  await page.getByRole("checkbox", { name: "Movies" }).check();

  // Save
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("dialog.service-form-dialog")).toBeHidden();

  // Navigate to the dashboard — the new tile should render its widget.
  await page.goto("/");
  const tile = page.locator(".service-tile").filter({ hasText: "My Plex" });
  await expect(tile.locator(".plex-widget")).toBeVisible({ timeout: 15_000 });
});
