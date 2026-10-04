import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";

const TILE_DATA = schemaV2Fixtures([{
  name: "Radarr",
  description: "Movie library and downloads",
  widget: { type: "radarr-stats", config: { url: "http://localhost:7878", api_key: "dummy" } },
}]);
const TILE_ID = TILE_DATA.service_tiles[0].id;
const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const STATS = { missing: 5, upcoming: 8, wanted: 10, queued: 2, available: 90, total: 120 };
const RESPONSE = { ok: true, data: STATS };

test.use({ locale: "en-US" });

function tile(page: Page) {
  return page.locator(".service-tile").filter({ has: page.locator('[data-widget-type="radarr-stats"]') });
}

async function configure(request: APIRequestContext, options: {
  theme?: (typeof THEMES)[number]; custom_css?: string; name?: string; description?: string; wide?: boolean;
} = {}) {
  expect((await request.patch("/api/settings", { data: {
    ...TILE_DATA,
    service_tiles: TILE_DATA.service_tiles.map((tile) => ({ ...tile, footprint: options.wide ? { columnSpan: 6, rowSpan: 2 } : { columnSpan: 3, rowSpan: 4 } })),
    services: TILE_DATA.services.map((service) => ({
      ...service, name: options.name ?? service.name, description: options.description ?? service.description,
    })),
    groups: [], bookmarks: [],
    appearance: { theme: options.theme ?? "dark", custom_css: options.custom_css },
  } })).ok()).toBe(true);
}

async function mockWidget(page: Page, response: unknown = RESPONSE) {
  await page.route("**/api/widget*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("tile_id") !== TILE_ID) return route.continue();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
}

async function layoutBounds(page: Page) {
  return tile(page).evaluate((element) => [element, ...element.querySelectorAll(".widget-stat")].map((node) => {
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x, y, width, height };
  }));
}

/** Check actual text and inner scroll bounds, not just the tile's clipped exterior. */
async function assertFits(page: Page, wide = false) {
  const fit = await tile(page).evaluate((element) => {
    const body = element.querySelector(".widget-body");
    const grid = element.querySelector(".widget-stat-grid");
    const notice = element.querySelector(".widget-body__notice");
    if (!body || !grid || !notice) return null;
    const rect = (node: Element) => node.getBoundingClientRect();
    const contains = (outer: DOMRect, inner: DOMRect) =>
      inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 &&
      inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
    const noScroll = (node: Element) => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight;
    const cards = Array.from(grid.querySelectorAll(".widget-stat"));
    const texts = cards.flatMap((card) => Array.from(card.children));
    const contentBounds = texts.map((text) => {
      const range = document.createRange();
      range.selectNodeContents(text);
      return { parent: text.parentElement!, bounds: range.getBoundingClientRect() };
    });
    const scrollBounds = [element, body, grid, ...cards, ...texts].map((node) => ({
      className: node.className, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
      scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
    }));
    return {
      scrollBounds,
      width: rect(element).width, height: rect(element).height,
      columns: new Set(cards.map((card) => Math.round(rect(card).left))).size,
      rows: new Set(cards.map((card) => Math.round(rect(card).top))).size,
      bodyInsideTile: contains(rect(element), rect(body)),
      gridInsideBody: contains(rect(body), rect(grid)),
      noticeInsideBody: contains(rect(body), rect(notice)),
      noticeAfterGrid: rect(notice).top >= rect(grid).bottom - 0.5,
      cardsInsideGrid: cards.every((card) => contains(rect(grid), rect(card))),
      textInsideCards: contentBounds.every(({ parent, bounds }) => contains(rect(parent), bounds)),
      noScroll: [element, body, grid, ...cards].every(noScroll),
    };
  });
  const { scrollBounds, ...measured } = fit!;
  expect(measured, JSON.stringify(scrollBounds)).toEqual({
    width: wide ? 688 : 340, height: wide ? 128 : 264, columns: wide ? 6 : 2, rows: wide ? 1 : 3,
    bodyInsideTile: true, gridInsideBody: true, noticeInsideBody: true, noticeAfterGrid: true,
    cardsInsideGrid: true, textInsideCards: true, noScroll: true,
  });
}

async function assertContrast(page: Page) {
  const contrast = await tile(page).locator(".widget-stat").evaluateAll((cards) => {
    const luminance = (color: string) => color.match(/\d+(?:\.\d+)?/g)!.slice(0, 3).map(Number)
      .map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    return cards.flatMap((card) => Array.from(card.children).map((text) => {
      const values = [luminance(getComputedStyle(text).color), luminance(getComputedStyle(card).backgroundColor)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    }));
  });
  expect(Math.min(...contrast)).toBeGreaterThanOrEqual(4.5);
}

test("Radarr uses six shared stat cards at both footprints across all themes", async ({ page, request }, testInfo) => {
  await mockWidget(page);
  for (const wide of [false, true]) {
    for (const theme of THEMES) {
      await configure(request, { theme, wide });
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(tile(page).locator(".widget-stat__label")).toHaveText(["Missing", "Upcoming", "Wanted", "Queued", "Available", "Total"]);
      await expect(tile(page).locator(".widget-stat__value")).toHaveText(["5", "8", "10", "2", "90", "120"]);
      await expect(tile(page).locator(".widget-stat--tone-alert")).toHaveText(/Missing/);
      const card = tile(page).locator(".widget-stat").first();
      await expect(card).toHaveCSS("padding", "6px 4px");
      await expect(card.locator(".widget-stat__value")).toHaveCSS("font-size", "16px");
      await expect(card.locator(".widget-stat__label")).toHaveCSS("font-size", "11px");
      await expect(tile(page).locator(".widget-stat-grid")).toHaveCSS("gap", "6px");
      await assertFits(page, wide);
      await assertContrast(page);
      const previewName = `radarr-${wide ? "6x2" : "3x4"}-${theme}`;
      await testInfo.attach(previewName, {
        body: await tile(page).screenshot({
          path: process.env.KOKPIT_WIDGET_PREVIEW_DIR
            ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/${previewName}.png` : undefined,
        }), contentType: "image/png",
      });
    }
  }
});

test("Radarr fits large values and preserves long service text", async ({ page, request }) => {
  const name = "Radarr movie management with an intentionally long service name";
  const description = "A deliberately long description of movie availability and download activity";
  await configure(request, { name, description });
  await mockWidget(page, { ok: true, data: {
    missing: 123456789, upcoming: 123456788, wanted: 1234567, queued: 987654321012, available: 123456780, total: 9,
  } });
  await page.goto("/");
  await expect(tile(page).locator(".widget-stat__value")).toHaveText(["123456789", "123456788", "1234567", "987654321012", "123456780", "9"]);
  await expect(tile(page).locator(".service-tile__name")).toHaveAttribute("title", name);
  await expect(tile(page).locator(".service-tile__description")).toHaveAttribute("title", description);
  await expect(tile(page).locator(".service-tile__header .service-tile__description")).toBeVisible();
  await expect(tile(page).locator(".service-tile__name")).toHaveCSS("white-space", "nowrap");
  await expect(tile(page).locator(".service-tile__description")).toHaveCSS("white-space", "nowrap");
  await assertFits(page);
});

test("Radarr card sizing matches the accepted Immich library cards", async ({ page, request }) => {
  const reference = schemaV2Fixtures([
    { name: "Radarr", size: "tall", widget: { type: "radarr-stats", config: { url: "http://localhost:7878", api_key: "dummy" } } },
    { name: "Immich", widget: { type: "immich-stats", config: { url: "http://localhost:2283/api", api_key: "dummy" } } },
  ]);
  expect((await request.patch("/api/settings", { data: {
    ...reference, groups: [], bookmarks: [], appearance: { theme: "dark" },
  } })).ok()).toBe(true);
  await page.route("**/api/widget*", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("tile_id");
    if (!reference.service_tiles.some((entry) => entry.id === id)) return route.continue();
    const response = id === reference.service_tiles[0].id
      ? RESPONSE : { ok: true, data: { usage: 1200000000, photos: 1234, videos: 56 } };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.goto("/");
  const radarrCard = tile(page).locator(".widget-stat").first();
  const immichCard = page.locator('[data-widget-type="immich-stats"] .widget-stat').first();
  await expect(radarrCard).toBeVisible();
  await expect(immichCard).toBeVisible();
  const metrics = async (card: typeof radarrCard) => card.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width, height: rect.height, padding: style.padding, gap: style.gap,
      valueFontSize: getComputedStyle(element.querySelector(".widget-stat__value")!).fontSize,
      labelFontSize: getComputedStyle(element.querySelector(".widget-stat__label")!).fontSize,
      gridGap: getComputedStyle(element.parentElement!).gap,
    };
  });
  expect(await metrics(radarrCard)).toEqual(await metrics(immichCard));
  await assertFits(page);
});

test("Radarr zero missing count retains a neutral tone", async ({ page, request }) => {
  await configure(request);
  await mockWidget(page, { ok: true, data: { ...STATS, missing: 0 } });
  await page.goto("/");
  const missingCard = tile(page).locator(".widget-stat").filter({ hasText: "Missing" });
  await expect(missingCard).toHaveClass(/widget-stat--tone-neutral/);
  await expect(missingCard.locator(".widget-stat__value")).toHaveText("0");
  await expect(tile(page).locator(".widget-stat--tone-alert")).toHaveCount(0);
});

test("Radarr initial loading/error use shared feedback and null data stays blank", async ({ page, request }) => {
  await configure(request);
  let releaseInitial!: () => void;
  const initial = new Promise<void>((resolve) => { releaseInitial = resolve; });
  let response: unknown = RESPONSE;
  await page.route("**/api/widget*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("tile_id") !== TILE_ID) return route.continue();
    await initial;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.goto("/");
  await expect(tile(page).getByRole("status", { name: "Loading widget" })).toHaveClass(/widget-state--loading/);
  releaseInitial();
  await expect(tile(page).locator(".widget-stat")).toHaveCount(6);
  response = { ok: false, error: "Radarr unavailable" };
  await page.reload();
  await expect(tile(page).getByRole("alert")).toHaveClass(/widget-state--error/);
  await expect(tile(page).getByRole("alert")).toHaveText("Radarr unavailable");
  await expect(tile(page).locator(".widget-stat")).toHaveCount(0);
  response = { ok: true, data: null };
  await page.reload();
  await expect(tile(page).locator(".radarr-stats-widget--empty")).toBeEmpty();
  await expect(tile(page).locator(".widget-state")).toHaveCount(0);
});

test("Radarr refresh failure and recovery retain data and card positions", async ({ page, request }, testInfo) => {
  let refreshFails = false;
  const error = "Radarr rejected the refresh because its configured API key is invalid";
  await page.route("**/api/widget*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("tile_id") !== TILE_ID) return route.continue();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(refreshFails ? { ok: false, error } : RESPONSE) });
  });
  await page.clock.install();
  for (const theme of THEMES) {
    refreshFails = false;
    await configure(request, { theme });
    await page.goto("/");
    await expect(tile(page).locator(".widget-stat")).toHaveCount(6);
    const healthyBounds = await layoutBounds(page);
    refreshFails = true;
    await page.clock.fastForward(60_000);
    const alert = tile(page).getByRole("alert");
    await expect(alert).toHaveText("Refresh failed · saved data");
    await expect(alert).toHaveAccessibleName(`Refresh failed; saved data is shown. ${error}`);
    await expect(alert).toHaveAttribute("title", error);
    await expect(tile(page).locator(".widget-stat__value")).toHaveText(["5", "8", "10", "2", "90", "120"]);
    expect(await layoutBounds(page)).toEqual(healthyBounds);
    await assertFits(page);
    await testInfo.attach(`Radarr-stale-${theme}`, { body: await tile(page).screenshot(), contentType: "image/png" });
    refreshFails = false;
    await page.clock.fastForward(60_000);
    await expect(alert).toHaveCount(0);
    expect(await layoutBounds(page)).toEqual(healthyBounds);
  }
});

test("ordinary custom CSS overrides Radarr cards, alert tone, grid and notice", async ({ page, request }) => {
  await configure(request, { custom_css: `
    .radarr-stats-widget__stat { background: #010203; border-radius: 12px; }
    .radarr-stats-widget__stat--missing .radarr-stats-widget__value { color: #040506; }
    .radarr-stats-widget__grid { gap: 10px; }
    .radarr-stats-widget { --widget-notice-padding-block: 3px; }
  ` });
  await mockWidget(page);
  await page.goto("/");
  await expect(tile(page).locator(".widget-stat")).toHaveCount(6);
  await expect(tile(page).locator(".widget-stat").first()).toHaveCSS("background-color", "rgb(1, 2, 3)");
  await expect(tile(page).locator(".widget-stat").first()).toHaveCSS("border-radius", "12px");
  await expect(tile(page).locator(".radarr-stats-widget__stat--missing .radarr-stats-widget__value")).toHaveCSS("color", "rgb(4, 5, 6)");
  await expect(tile(page).locator(".widget-stat-grid")).toHaveCSS("gap", "10px");
  await expect(tile(page).locator(".widget-body__notice")).toHaveCSS("padding-top", "3px");
  await assertFits(page);
});


test("Radarr preview alongside the accepted Prowlarr design", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 760, height: 780 });
  const reference = schemaV2Fixtures([
    { name: "Prowlarr", description: "Indexer health and grabs", widget: { type: "prowlarr-stats", config: { url: "http://localhost:9696", api_key: "dummy" } } },
    { name: "Radarr", description: "Movie library and downloads", size: "tall", widget: { type: "radarr-stats", config: { url: "http://localhost:7878", api_key: "dummy" } } },
    { name: "Radarr · Wide", description: "All six metrics at 6×2", size: "wide", widget: { type: "radarr-stats", config: { url: "http://localhost:7878", api_key: "dummy" } } },
  ]);
  await page.route("**/api/widget*", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("tile_id");
    if (!reference.service_tiles.some((entry) => entry.id === id)) return route.continue();
    const response = id === reference.service_tiles[0].id
      ? { ok: true, data: { totalIndexers: 12, enabledIndexers: 11, failingIndexers: 1, totalGrabs: 1234, usenetIndexers: 8, torrentIndexers: 4 } }
      : RESPONSE;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  for (const theme of ["dark", "light"] as const) {
    expect((await request.patch("/api/settings", { data: {
      ...reference, groups: [], bookmarks: [], appearance: { theme },
    } })).ok()).toBe(true);
    await page.goto("/");
    await expect(page.locator(".widget-stat")).toHaveCount(18);
    const portrait = page.locator('[data-footprint="3x4"].radarr-stats-widget .widget-stat').first();
    const previous = page.locator('.prowlarr-stats-widget .widget-stat').first();
    const bounds = async (card: typeof portrait) => card.evaluate((element) => {
      const { width, height } = element.getBoundingClientRect();
      return { width, height };
    });
    expect(await bounds(portrait)).toEqual(await bounds(previous));
    await testInfo.attach(`Radarr-comparison-${theme}`, {
      body: await page.locator(".dashboard-tile-grid").screenshot({
        path: process.env.KOKPIT_WIDGET_PREVIEW_DIR
          ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/radarr-comparison-${theme}.png` : undefined,
      }), contentType: "image/png",
    });
  }
});
