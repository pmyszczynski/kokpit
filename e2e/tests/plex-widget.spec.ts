import { test, expect } from "@playwright/test";
import { DEFAULT_MOCK_STATE } from "../helpers/mock-plex-server";
import type { MockPlexState } from "../helpers/mock-plex-server";

const MOCK = "http://localhost:32400";

/** Reset mock server to the default state before every test. */
test.beforeEach(async ({ request }) => {
  await request.post(`${MOCK}/__control`, { data: DEFAULT_MOCK_STATE });
});

// ── Test 1 ───────────────────────────────────────────────────────────────────

test("widget renders data from the mock server", async ({ page }) => {
  const responsePromise = page.waitForResponse((r) =>
    r.url().includes("/api/widget")
  );
  await page.goto("/");
  await responsePromise;

  await expect(page.locator(".plex-widget")).toBeVisible();

  await expect(
    page.locator(".plex-widget__stat").filter({ hasText: "Streaming" }).locator(".plex-widget__value")
  ).toHaveText("2");

  await expect(
    page.locator(".plex-widget__stat").filter({ hasText: "Transcoding" }).locator(".plex-widget__value")
  ).toHaveText("1");

  await expect(
    page.locator(".plex-widget__stat").filter({ hasText: "Movies" }).locator(".plex-widget__value")
  ).toHaveText("150");
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

  const responsePromise = page.waitForResponse((r) =>
    r.url().includes("/api/widget")
  );
  await page.goto("/");
  await responsePromise;

  await expect(
    page.locator(".plex-widget__stat").filter({ hasText: "Streaming" }).locator(".plex-widget__value")
  ).toHaveText("5");

  await expect(
    page.locator(".plex-widget__stat").filter({ hasText: "Transcoding" }).locator(".plex-widget__value")
  ).toHaveText("3");
});

// ── Test 3 ───────────────────────────────────────────────────────────────────

test("widget shows error state when Plex returns an error", async ({ page, request }) => {
  await request.post(`${MOCK}/__control`, {
    data: { ...DEFAULT_MOCK_STATE, error: 503 },
  });

  const responsePromise = page.waitForResponse((r) =>
    r.url().includes("/api/widget")
  );
  await page.goto("/");
  await responsePromise;

  await expect(page.locator(".widget-error")).toBeVisible();
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

  // Fill in the service name
  await page.fill("#sf-name", "My Plex");

  // Select the Plex widget type
  await page.selectOption("#sf-widget-type", "plex");

  // Fill widget config fields (rendered dynamically after type selection)
  await page.fill("#sf-widget-url", "http://localhost:32400");
  await page.fill("#sf-widget-token", "test-token");

  // Select display fields
  await page.getByRole("checkbox", { name: "Streaming" }).check();
  await page.getByRole("checkbox", { name: "Movies" }).check();

  // Save
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("dialog.service-form-dialog")).toBeHidden();

  // Navigate to the dashboard — the new tile should render its widget
  await page.goto("/");
  const tile = page.locator(".service-tile").filter({ hasText: "My Plex" });
  await expect(tile.locator(".plex-widget")).toBeVisible({ timeout: 15_000 });
});
