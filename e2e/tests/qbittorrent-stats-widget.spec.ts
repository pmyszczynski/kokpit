import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";

const TILE_DATA = schemaV2Fixtures([{
  name: "qBittorrent",
  description: "Transfer rates and totals",
  widget: {
    type: "qbittorrent-stats",
    config: { url: "http://localhost:8080", username: "admin", password: "dummy" },
  },
}]);
const TILE_ID = TILE_DATA.service_tiles[0].id;
const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const FOOTPRINTS = [
  { columnSpan: 3, rowSpan: 2, cards: 2, columns: 2, height: 128 },
  { columnSpan: 3, rowSpan: 4, cards: 6, columns: 2, height: 264 },
  { columnSpan: 6, rowSpan: 2, cards: 4, columns: 4, height: 128 },
] as const;

const TRANSFER_RESPONSE = {
  ok: true,
  data: {
    dl_info_speed: 999_900_000,
    up_info_speed: 123_450_000,
    dl_info_data: 987_654_300_000_000,
    up_info_data: 987_650_000_000,
    activity: { active: 12_345, queued: 3456 },
  },
};
const SPEED_VALUES = ["999.9 MB/s", "123.5 MB/s"];
const TRANSFER_VALUES = [...SPEED_VALUES, "987654.3 GB", "987.6 GB"];
const ACTIVITY_VALUES = ["12345", "3456"];

function settingsFor(
  footprint: { columnSpan: number; rowSpan: number },
  options: { theme?: (typeof THEMES)[number]; custom_css?: string; name?: string; description?: string } = {}
) {
  return {
    ...TILE_DATA,
    groups: [],
    bookmarks: [],
    services: TILE_DATA.services.map((service) => ({
      ...service,
      name: options.name ?? service.name,
      description: options.description ?? service.description,
    })),
    service_tiles: TILE_DATA.service_tiles.map((tile) => ({ ...tile, footprint })),
    appearance: { theme: options.theme ?? "dark", custom_css: options.custom_css },
  };
}

function tile(page: Page) {
  return page.locator(".service-tile").filter({
    has: page.locator('[data-widget-type="qbittorrent-stats"]'),
  });
}

async function mockWidget(page: Page, response: unknown = TRANSFER_RESPONSE) {
  await page.route("**/api/widget*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("tile_id") !== TILE_ID) {
      return route.continue();
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
}

async function setFootprint(
  request: APIRequestContext,
  footprint: { columnSpan: number; rowSpan: number },
  options: Parameters<typeof settingsFor>[1] = {}
) {
  const response = await request.patch("/api/settings", { data: settingsFor(footprint, options) });
  expect(response.ok(), `settings update failed for ${footprint.columnSpan}x${footprint.rowSpan}`).toBe(true);
}

async function layoutBounds(page: Page) {
  return tile(page).evaluate((element) => {
    const rect = (node: Element) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    };
    return [element, ...element.querySelectorAll(".widget-stat")].map(rect);
  });
}

async function assertFits(page: Page, expectedHeight: number) {
  const fit = await tile(page).evaluate((element) => {
    const body = element.querySelector(".widget-body");
    const grid = element.querySelector(".widget-stat-grid");
    const notice = element.querySelector(".widget-body__notice");
    if (!body || !grid || !notice) return null;
    const rect = (node: Element) => node.getBoundingClientRect();
    const contains = (outer: DOMRect, inner: DOMRect) =>
      inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 &&
      inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
    const noScroll = (node: Element) =>
      node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight;
    const cards = Array.from(grid.querySelectorAll(".widget-stat"));
    return {
      tileHeight: rect(element).height,
      descriptionInHeader: !element.querySelector(".service-tile__description") ||
        contains(rect(element.querySelector(".service-tile__header")!),
          rect(element.querySelector(".service-tile__description")!)),
      bodyInsideTile: contains(rect(element), rect(body)),
      gridInsideBody: contains(rect(body), rect(grid)),
      noticeInsideBody: contains(rect(body), rect(notice)),
      noticeAfterGrid: rect(notice).top >= rect(grid).bottom - 0.5,
      cardsInsideGrid: cards.every((card) => contains(rect(grid), rect(card))),
      textInsideCards: cards.every((card) => Array.from(card.children).every((child) =>
        contains(rect(card), rect(child))
      )),
      noScroll: [element, body, grid, ...cards].every(noScroll),
    };
  });
  expect(fit).toEqual({
    tileHeight: expectedHeight,
    descriptionInHeader: true,
    bodyInsideTile: true,
    gridInsideBody: true,
    noticeInsideBody: true,
    noticeAfterGrid: true,
    cardsInsideGrid: true,
    textInsideCards: true,
    noScroll: true,
  });
}

test("qBittorrent stats show footprint-specific values without clipping in all themes", async ({ page, request }) => {
  await mockWidget(page);
  for (const footprint of FOOTPRINTS) {
    for (const theme of THEMES) {
      await setFootprint(request, footprint, { theme });
      await page.goto("/");
      const grid = tile(page).locator(".widget-stat-grid");
      await expect(grid).toHaveAttribute("data-columns", String(footprint.columns));
      await expect(grid.locator(".widget-stat")).toHaveCount(footprint.cards);
      await expect(grid.locator(".widget-stat__value")).toHaveText(
        footprint.cards === 2 ? SPEED_VALUES :
          footprint.rowSpan === 4 ? [...TRANSFER_VALUES, ...ACTIVITY_VALUES] : TRANSFER_VALUES
      );
      if (footprint.rowSpan === 4) {
        await expect(grid.locator(".qbt-stats-widget__activity-stat dt"))
          .toHaveText(["Active", "Queued"]);
        await expect(grid.locator(".qbt-stats-widget__activity-stat dd"))
          .toHaveText(ACTIVITY_VALUES);
      } else {
        await expect(grid.locator(".qbt-stats-widget__activity-stat")).toHaveCount(0);
      }
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const cardBounds = (await layoutBounds(page)).slice(1);
      expect(new Set(cardBounds.map((item) => item.x)).size).toBe(footprint.columns);
      expect(new Set(cardBounds.map((item) => item.y)).size)
        .toBe(footprint.cards / footprint.columns);
      if (footprint.rowSpan === 4) {
        const rows = Array.from({ length: 3 }, (_, index) => cardBounds.slice(index * 2, index * 2 + 2));
        for (const row of rows) {
          expect(Math.abs(row[0].y - row[1].y)).toBeLessThan(0.5);
          expect(Math.abs(row[0].height - row[1].height)).toBeLessThan(0.5);
          expect(Math.abs(row[0].height - rows[0][0].height)).toBeLessThan(0.5);
        }
        for (let index = 1; index < rows.length; index++) {
          expect(rows[index - 1][0].y + rows[index - 1][0].height)
            .toBeLessThanOrEqual(rows[index][0].y + 0.5);
        }
      }
      await assertFits(page, footprint.height);
    }
  }
});

test("qBittorrent 3x4 distinguishes zero activity from unavailable activity without moving cards", async ({ page, request }) => {
  await setFootprint(request, FOOTPRINTS[1]);
  let activity: typeof TRANSFER_RESPONSE.data.activity | null = {
    active: 0, queued: 0,
  };
  await page.route("**/api/widget*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("tile_id") !== TILE_ID) return route.continue();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      ...TRANSFER_RESPONSE,
      data: { ...TRANSFER_RESPONSE.data, activity },
    }) });
  });
  await page.goto("/");
  await expect(tile(page).locator(".qbt-stats-widget__activity-stat dd"))
    .toHaveText(["0", "0"]);
  const healthyBounds = await layoutBounds(page);
  await assertFits(page, 264);

  activity = null;
  await page.reload();
  await expect(tile(page).getByRole("status")).toHaveText("Activity unavailable");
  await expect(tile(page).locator(".qbt-stats-widget__activity-stat dd"))
    .toHaveText(["—", "—"]);
  expect(await layoutBounds(page)).toEqual(healthyBounds);
  await assertFits(page, 264);
});

test("qBittorrent 3x4 cards match the shared Immich stat cards", async ({ page, request }) => {
  const sharedReference = schemaV2Fixtures([
    {
      name: "qBittorrent",
      description: "Transfer rates and totals",
      widget: {
        type: "qbittorrent-stats",
        config: { url: "http://localhost:8080", username: "admin", password: "dummy" },
      },
    },
    {
      name: "Immich",
      description: "Storage and items",
      widget: {
        type: "immich-stats",
        config: { url: "http://localhost:2283/api", api_key: "dummy" },
      },
    },
  ]);
  const settings = {
    ...settingsFor(FOOTPRINTS[1]),
    services: sharedReference.services,
    service_tiles: sharedReference.service_tiles.map((entry, index) => ({
      ...entry,
      footprint: index === 0 ? FOOTPRINTS[1] : FOOTPRINTS[0],
    })),
  };
  expect((await request.patch("/api/settings", { data: settings })).ok()).toBe(true);
  await page.route("**/api/widget*", async (route) => {
    const tileId = new URL(route.request().url()).searchParams.get("tile_id");
    const response = tileId === sharedReference.service_tiles[0].id
      ? TRANSFER_RESPONSE
      : { ok: true, data: { usage: 1_200_000_000, photos: 1234, videos: 56 } };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.goto("/");
  const qbittorrentCard = tile(page).locator(".widget-stat").first();
  const immichCard = page.locator('[data-widget-type="immich-stats"] .widget-stat').first();
  await expect(tile(page).locator(".widget-stat")).toHaveCount(6);
  await expect(immichCard).toBeVisible();
  const metrics = async (card: typeof qbittorrentCard) => card.evaluate((element) => {
    const style = getComputedStyle(element);
    const value = element.querySelector(".widget-stat__value")!;
    const label = element.querySelector(".widget-stat__label")!;
    const bounds = element.getBoundingClientRect();
    return {
      width: bounds.width,
      height: bounds.height,
      padding: style.padding,
      gap: style.gap,
      valueFontSize: getComputedStyle(value).fontSize,
      labelFontSize: getComputedStyle(label).fontSize,
      gridGap: getComputedStyle(element.parentElement!).gap,
    };
  });
  expect(await metrics(qbittorrentCard)).toEqual(await metrics(immichCard));
  await assertFits(page, 264);
});

test("qBittorrent compact header retains long service text without taking stat space", async ({ page, request }) => {
  const name = "qBittorrent transfer service with a deliberately long display name";
  const description = "A deliberately long description of download and upload activity";
  await setFootprint(request, FOOTPRINTS[0], { name, description });
  await mockWidget(page);
  await page.goto("/");
  await expect(tile(page).locator(".service-tile__header .service-tile__name"))
    .toHaveAttribute("title", name);
  await expect(tile(page).locator(".service-tile__header .service-tile__description"))
    .toHaveAttribute("title", description);
  await expect(tile(page).locator(".widget-stat__value")).toHaveText(SPEED_VALUES);
  await assertFits(page, 128);
});

test("qBittorrent initial loading, error and domain empty states use shared feedback", async ({ page, request }) => {
  await setFootprint(request, FOOTPRINTS[0]);
  let releaseInitial: (() => void) | undefined;
  const initial = new Promise<void>((resolve) => { releaseInitial = resolve; });
  let response: unknown = TRANSFER_RESPONSE;
  await page.route("**/api/widget*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("tile_id") !== TILE_ID) return route.continue();
    await initial;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.goto("/");
  await expect(tile(page).locator(".widget-state--loading")).toBeVisible();
  releaseInitial!();
  await expect(tile(page).locator(".widget-stat")).toHaveCount(2);
  response = { ok: false, error: "qBittorrent unavailable" };
  await page.reload();
  await expect(tile(page).locator(".widget-state--error")).toHaveText("qBittorrent unavailable");
  response = { ok: true, data: null };
  await page.reload();
  await expect(tile(page).locator(".widget-state--empty")).toBeVisible();
  await expect(tile(page).locator(".widget-stat")).toHaveCount(0);
});

test("qBittorrent stale warnings preserve stats and card positions for every footprint", async ({ page, request }) => {
  let refreshFails = false;
  let error = "qBittorrent rejected the refresh request";
  await page.route("**/api/widget*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("tile_id") !== TILE_ID) return route.continue();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(
      refreshFails ? { ok: false, error } : TRANSFER_RESPONSE
    ) });
  });
  await page.clock.install({ time: new Date("2026-09-27T00:00:00Z") });
  for (const footprint of FOOTPRINTS) {
    await setFootprint(request, footprint);
    refreshFails = false;
    await page.goto("/");
    await expect(tile(page).locator(".widget-stat")).toHaveCount(footprint.cards);
    const healthyBounds = await layoutBounds(page);
    refreshFails = true;
    await page.clock.fastForward(10_000);
    const alert = tile(page).getByRole("alert");
    await expect(alert).toHaveAttribute("title", error);
    await expect(alert).toHaveAccessibleName(`Refresh failed; saved data is shown. ${error}`);
    expect(await layoutBounds(page)).toEqual(healthyBounds);
    await assertFits(page, footprint.height);
    error = "qBittorrent timed out during refresh";
    await page.clock.fastForward(10_000);
    await expect(alert).toHaveAttribute("title", error);
    expect(await layoutBounds(page)).toEqual(healthyBounds);
    refreshFails = false;
    await page.clock.fastForward(10_000);
    await expect(alert).toHaveCount(0);
    expect(await layoutBounds(page)).toEqual(healthyBounds);
  }
});

test("ordinary custom CSS overrides qBittorrent's shared cards", async ({ page, request }) => {
  await setFootprint(request, FOOTPRINTS[1], {
    custom_css: ".widget-stat { background: #010203; } .widget-stat__value { color: #040506; } .widget-stat-grid { gap: 10px; } .qbt-stats-widget__activity-stat dd { color: #070809; }",
  });
  await mockWidget(page);
  await page.goto("/");
  await expect(tile(page).locator(".widget-stat").first()).toHaveCSS("background-color", "rgb(1, 2, 3)");
  await expect(tile(page).locator(".widget-stat__value").first()).toHaveCSS("color", "rgb(4, 5, 6)");
  await expect(tile(page).locator(".widget-stat-grid")).toHaveCSS("gap", "10px");
  await expect(tile(page).locator(".qbt-stats-widget__activity-stat dd").first()).toHaveCSS("color", "rgb(7, 8, 9)");
  await assertFits(page, 264);
});
