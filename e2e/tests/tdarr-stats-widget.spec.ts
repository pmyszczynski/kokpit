import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";

const TILE_DATA = schemaV2Fixtures([{
  name: "Tdarr",
  description: "Transcodes and storage savings",
  widget: { type: "tdarr-stats", config: { url: "http://localhost:8265", apikey: "dummy" } },
}]);
const TILE_ID = TILE_DATA.service_tiles[0].id;
const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const STATS = { transcodeQueue: 12, healthCheckQueue: 5, errored: 3, spaceSavedGb: 12400, activeWorkers: 4, fps: 65.8, transcoded: 480, totalFiles: 1000 };
const FOOTPRINTS = [{ columnSpan: 3, rowSpan: 2 }, { columnSpan: 3, rowSpan: 4 }, { columnSpan: 6, rowSpan: 2 }] as const;
const RESPONSE = { ok: true, data: STATS };

test.use({ locale: "en-US" });

function tile(page: Page) {
  return page.locator(".service-tile").filter({ has: page.locator('[data-widget-type="tdarr-stats"]') });
}

async function configure(request: APIRequestContext, options: {
  theme?: (typeof THEMES)[number]; custom_css?: string; name?: string; description?: string; footprint?: { columnSpan: number; rowSpan: number };
} = {}) {
  expect((await request.patch("/api/settings", { data: {
    ...TILE_DATA,
    service_tiles: TILE_DATA.service_tiles.map((tile) => ({ ...tile, footprint: options.footprint ?? { columnSpan: 3, rowSpan: 2 } })),
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
async function assertFits(page: Page, footprint = { columnSpan: 3, rowSpan: 2 }) {
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
    width: footprint.columnSpan === 6 ? 688 : 340, height: footprint.rowSpan === 4 ? 264 : 128,
    columns: footprint.columnSpan === 6 ? 3 : 2, rows: footprint.rowSpan === 4 ? 3 : 1,
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


function labelsFor(footprint: { columnSpan: number; rowSpan: number }) {
  return footprint.rowSpan === 4 ? ["Transcode Queue", "Health Checks", "Errored", "Space Saved", "Workers", "FPS"]
    : footprint.columnSpan === 6 ? ["Transcode Queue", "Workers", "Space Saved"] : ["Transcode Queue", "Workers"];
}

function valuesFor(footprint: { columnSpan: number; rowSpan: number }) {
  return footprint.rowSpan === 4 ? ["12", "5", "3", "12.4 TB", "4", "65.8"]
    : footprint.columnSpan === 6 ? ["12", "4", "12.4 TB"] : ["12", "4"];
}

test("Tdarr uses two compact, three wide, and six detailed cards in every theme", async ({ page, request }, testInfo) => {
  await mockWidget(page);
  for (const footprint of FOOTPRINTS) {
    for (const theme of THEMES) {
      await configure(request, { theme, footprint });
      await page.goto("/");
      await expect(tile(page).locator(".widget-stat__label")).toHaveText(labelsFor(footprint));
      await expect(tile(page).locator(".widget-stat__value")).toHaveText(valuesFor(footprint));
      const tones = footprint.rowSpan === 4 ? ["warning", "warning", "alert", "positive", "positive", "info"]
        : footprint.columnSpan === 6 ? ["warning", "positive", "positive"] : ["warning", "positive"];
      for (const [index, tone] of tones.entries()) {
        await expect(tile(page).locator(".widget-stat").nth(index)).toHaveClass(new RegExp(`widget-stat--tone-${tone}`));
      }
      await assertFits(page, footprint);
      await assertContrast(page);
      const name = `tdarr-stats-${footprint.columnSpan}x${footprint.rowSpan}-${theme}`;
      await testInfo.attach(name, { body: await tile(page).screenshot({
        path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/${name}.png` : undefined,
      }), contentType: "image/png" });
    }
  }
});

test("Tdarr retains large values and accessible long service text", async ({ page, request }) => {
  const name = "Tdarr transcoding service with an intentionally long name";
  const description = "A deliberately long description of transcoding jobs, worker activity and storage savings";
  await mockWidget(page, { ok: true, data: { ...STATS, transcodeQueue: 123456789, healthCheckQueue: 987654321,
    errored: 12345678, spaceSavedGb: 99999999, activeWorkers: 123456789, fps: 123456.7 } });
  for (const footprint of FOOTPRINTS) {
    await configure(request, { name, description, footprint });
    await page.goto("/");
    await expect(tile(page).locator(".widget-stat")).toHaveCount(labelsFor(footprint).length);
    await expect(tile(page).locator(".widget-stat__value").first()).toHaveText("123456789");
    await expect(tile(page).locator(".service-tile__name")).toHaveAttribute("title", name);
    await expect(tile(page).locator(".service-tile__description")).toHaveAttribute("title", description);
    await assertFits(page, footprint);
  }
});

test("Tdarr keeps zero and unavailable optional activity neutral", async ({ page, request }) => {
  await configure(request, { footprint: { columnSpan: 3, rowSpan: 4 } });
  await mockWidget(page, { ok: true, data: { ...STATS, transcodeQueue: 0, healthCheckQueue: 0, errored: 0, spaceSavedGb: 0, activeWorkers: 0, fps: 0 } });
  await page.goto("/");
  await expect(tile(page).locator(".widget-stat__value")).toHaveText(["0", "0", "0", "0 B", "0", "0.0"]);
  for (const card of await tile(page).locator(".widget-stat").all()) {
    await expect(card).toHaveClass(/widget-stat--tone-neutral/);
  }
  await assertFits(page, { columnSpan: 3, rowSpan: 4 });
});

test("Tdarr initial states use shared feedback and null data stays blank", async ({ page, request }) => {
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
  await expect(tile(page).locator(".widget-stat")).toHaveCount(2);
  response = { ok: false, error: "Tdarr unavailable" };
  await page.reload();
  await expect(tile(page).getByRole("alert")).toHaveClass(/widget-state--error/);
  await expect(tile(page).getByRole("alert")).toHaveText("Tdarr unavailable");
  response = { ok: true, data: null };
  await page.reload();
  await expect(tile(page).locator(".tdarr-stats-widget--empty")).toBeEmpty();
});

test("Tdarr refresh failure/recovery retains metrics and positions", async ({ page, request }, testInfo) => {
  let fails = false;
  const error = "Tdarr rejected the API key during refresh";
  await page.route("**/api/widget*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("tile_id") !== TILE_ID) return route.continue();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(fails ? { ok: false, error } : RESPONSE) });
  });
  await page.clock.install();
  for (const footprint of FOOTPRINTS) {
    for (const theme of THEMES) {
      fails = false;
      await configure(request, { footprint, theme });
      await page.goto("/");
      await expect(tile(page).locator(".widget-stat")).toHaveCount(labelsFor(footprint).length);
      const healthy = await layoutBounds(page);
      fails = true;
      await page.clock.fastForward(10_000);
      const alert = tile(page).getByRole("alert");
      await expect(alert).toHaveText("Refresh failed · saved data");
      await expect(alert).toHaveAccessibleName(`Refresh failed; saved data is shown. ${error}`);
      await expect(tile(page).locator(".widget-stat__value")).toHaveText(valuesFor(footprint));
      expect(await layoutBounds(page)).toEqual(healthy);
      await assertFits(page, footprint);
      if (theme === "dark") {
        const name = `tdarr-stats-stale-${footprint.columnSpan}x${footprint.rowSpan}-${theme}`;
        await testInfo.attach(name, { body: await tile(page).screenshot({
          path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/${name}.png` : undefined,
        }), contentType: "image/png" });
      }
      fails = false;
      await page.clock.fastForward(10_000);
      await expect(alert).toHaveCount(0);
      expect(await layoutBounds(page)).toEqual(healthy);
    }
  }
});

test("ordinary custom CSS overrides Tdarr shared cards and notice", async ({ page, request }) => {
  await configure(request, { custom_css: `
    .tdarr-stats-widget__stat { background: #010203; border-radius: 12px; }
    .tdarr-stats-widget__value { color: #040506; }
    .tdarr-stats-widget__grid { gap: 10px; }
    .tdarr-stats-widget { --widget-notice-padding-block: 3px; }
  ` });
  await mockWidget(page);
  await page.goto("/");
  await expect(tile(page).locator(".widget-stat")).toHaveCount(2);
  await expect(tile(page).locator(".widget-stat").first()).toHaveCSS("background-color", "rgb(1, 2, 3)");
  await expect(tile(page).locator(".widget-stat").first()).toHaveCSS("border-radius", "12px");
  await expect(tile(page).locator(".widget-stat__value").first()).toHaveCSS("color", "rgb(4, 5, 6)");
  await expect(tile(page).locator(".widget-stat-grid")).toHaveCSS("gap", "10px");
  await expect(tile(page).locator(".widget-body__notice")).toHaveCSS("padding-top", "3px");
  await assertFits(page);
});

test("Tdarr compact, detailed and wide previews match the library design", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1108, height: 780 });
  const reference = schemaV2Fixtures([
    { name: "qBittorrent", description: "Download and upload speeds", size: "normal", widget: { type: "qbittorrent-stats", config: { url: "http://localhost:8081", username: "admin", password: "dummy" } } },
    { name: "Tdarr · Compact", description: "Queue and active workers", size: "normal", widget: { type: "tdarr-stats", config: { url: "http://localhost:8265", apikey: "dummy" } } },
    { name: "Tdarr · Detailed", description: "Queues, errors, savings and activity", size: "tall", widget: { type: "tdarr-stats", config: { url: "http://localhost:8265", apikey: "dummy" } } },
    { name: "Tdarr · Wide", description: "Queue, workers and storage savings", size: "wide", widget: { type: "tdarr-stats", config: { url: "http://localhost:8265", apikey: "dummy" } } },
  ]);
  await page.route("**/api/widget*", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("tile_id");
    if (!reference.service_tiles.some((entry) => entry.id === id)) return route.continue();
    const response = id === reference.service_tiles[0].id
      ? { ok: true, data: { dl_info_speed: 5_500_000, up_info_speed: 500_000, dl_info_data: 1200000000, up_info_data: 345000000, activity: null } }
      : RESPONSE;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  for (const theme of ["dark", "light"] as const) {
    expect((await request.patch("/api/settings", { data: { ...reference, groups: [], bookmarks: [], appearance: { theme } } })).ok()).toBe(true);
    await page.goto("/");
    await expect(page.locator(".widget-stat")).toHaveCount(13);
    const metrics = async (widget: string) => page.locator(`[data-widget-type="${widget}"] .widget-stat`).first().evaluate((element) => {
      const style = getComputedStyle(element);
      return { padding: style.padding, radius: style.borderRadius, height: element.getBoundingClientRect().height,
        valueFontSize: getComputedStyle(element.querySelector(".widget-stat__value")!).fontSize,
        labelFontSize: getComputedStyle(element.querySelector(".widget-stat__label")!).fontSize };
    });
    expect(await metrics("tdarr-stats")).toEqual(await metrics("qbittorrent-stats"));
    await testInfo.attach(`Tdarr-comparison-${theme}`, { body: await page.locator(".dashboard-tile-grid").screenshot({
      path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/tdarr-stats-comparison-${theme}.png` : undefined,
    }), contentType: "image/png" });
  }
});
