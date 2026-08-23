import { test, expect, type Page } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";

const PROWLARR_TILE_DATA = schemaV2Fixtures([
  {
    name: "Prowlarr",
    url: "http://localhost:9696",
    widget: {
      type: "prowlarr-stats",
      config: {
        url: "http://localhost:9696",
        api_key: "dummy",
      },
    },
  },
]);

const TILE_ID = PROWLARR_TILE_DATA.service_tiles[0].id;
const PROWLARR_SETTINGS = {
  ...PROWLARR_TILE_DATA,
  groups: [],
  bookmarks: [],
  appearance: { theme: "dark" as const, custom_css: undefined },
};

function prowlarrTile(page: Page) {
  return page
    .locator(".service-tile")
    .filter({ has: page.locator('.service-tile__name:text-is("Prowlarr")') });
}

function prowlarrWidget(page: Page) {
  return prowlarrTile(page).locator(".prowlarr-stats-widget");
}

test("prowlarr widget defaults to tall footprint and renders without clipping", async ({
  page,
  request,
}) => {
  const settingsResponse = await request.patch("/api/settings", {
    data: PROWLARR_SETTINGS,
  });
  expect(settingsResponse.ok()).toBe(true);

  await page.route("**/api/widget*", async (route) => {
    const url = new URL(route.request().url());
    const tileId = url.searchParams.get("tile_id");
    if (tileId === TILE_ID) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            totalIndexers: 12,
            enabledIndexers: 11,
            failingIndexers: 1,
            totalGrabs: 1_234,
          },
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  const tile = prowlarrTile(page);
  const widget = prowlarrWidget(page);
  await expect(tile).toHaveCount(1);
  await expect(tile.locator(".service-tile__name")).toHaveText("Prowlarr");
  await expect(tile).toHaveClass(/service-tile--tall/);
  await expect(widget).toBeVisible();
  await expect(widget.locator(".prowlarr-stats-widget__stat")).toHaveCount(4);

  const overflow = await widget.evaluate((element) => {
    const widgetBounds = element.getBoundingClientRect();
    const tileBounds = element.closest(".service-tile")!.getBoundingClientRect();
    const statBounds = Array.from(
      element.querySelectorAll(".prowlarr-stats-widget__stat")
    ).map((stat) => {
      const bounds = stat.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
    });

    return {
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      styleOverflowY: getComputedStyle(element).overflowY,
      styleOverflowX: getComputedStyle(element).overflowX,
      statsStayInside: statBounds.every(
        (bounds) =>
          bounds.left >= widgetBounds.left &&
          bounds.right <= widgetBounds.right &&
          bounds.top >= widgetBounds.top &&
          bounds.bottom <= widgetBounds.bottom
      ),
      widgetStaysInsideTile:
        widgetBounds.left >= tileBounds.left &&
        widgetBounds.right <= tileBounds.right &&
        widgetBounds.top >= tileBounds.top &&
        widgetBounds.bottom <= tileBounds.bottom,
      columns: new Set(statBounds.map((bounds) => Math.round(bounds.left))).size,
      rows: new Set(statBounds.map((bounds) => Math.round(bounds.top))).size,
    };
  });
  expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.clientHeight);
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  expect(overflow.styleOverflowY).toBe("hidden");
  expect(overflow.styleOverflowX).toBe("hidden");
  expect(overflow.statsStayInside).toBe(true);
  expect(overflow.widgetStaysInsideTile).toBe(true);
  expect(overflow.columns).toBe(2);
  expect(overflow.rows).toBe(2);

  await expect(page.locator(".service-tile--tall")).toBeVisible();
});
