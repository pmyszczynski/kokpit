import { test, expect, type Page } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";

const IMMICH_TILE_DATA = schemaV2Fixtures([
  {
    name: "Immich",
    description: "Private photo and video library",
    widget: {
      type: "immich-stats",
      config: { url: "http://localhost:2283/api", api_key: "dummy" },
    },
  },
]);

const TILE_ID = IMMICH_TILE_DATA.service_tiles[0].id;
const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const EXPECTED_VALUES = ["9.9 TB", "123,555,554"];

const STATS_RESPONSE = {
  ok: true,
  data: {
    photos: 123_456_789,
    videos: 98_765,
    usage: 9_876_500_000_000,
    usagePhotos: 98_765_432,
    usageVideos: 2_000,
  },
};

/**
 * Immich's registered fixed-grid choices. Keep this in lockstep with the
 * widget registry, because the fit checks below exercise the supported choice.
 */
const PILOT_FOOTPRINTS = [
  { label: "Default", columnSpan: 3, rowSpan: 2 },
] as const;

function settingsFor(
  footprint: { columnSpan: number; rowSpan: number },
  appearance: { theme?: (typeof THEMES)[number]; custom_css?: string } = {},
  text: { name?: string; description?: string } = {}
) {
  return {
    ...IMMICH_TILE_DATA,
    groups: [],
    bookmarks: [],
    services: IMMICH_TILE_DATA.services.map((service) => ({
      ...service,
      name: text.name ?? service.name,
      description: text.description ?? service.description,
    })),
    service_tiles: IMMICH_TILE_DATA.service_tiles.map((tile) => ({ ...tile, footprint })),
    appearance: { theme: appearance.theme ?? "dark", custom_css: appearance.custom_css },
  };
}

function immichTile(page: Page) {
  return page.locator(".service-tile").filter({
    has: page.locator('[data-widget-type="immich-stats"]'),
  });
}

function immichWidget(page: Page) {
  return immichTile(page).locator(".immich-stats-widget");
}

async function immichLayoutBounds(page: Page) {
  return immichTile(page).evaluate((tile) => {
    const bounds = (element: Element) => {
      const { x, y, width, height, top, right, bottom, left } = element.getBoundingClientRect();
      return { x, y, width, height, top, right, bottom, left };
    };
    return [tile, ...tile.querySelectorAll(".immich-stats-widget__stat")].map(bounds);
  });
}

async function mockWidget(page: Page, response: unknown = STATS_RESPONSE) {
  await page.route("**/api/widget*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("tile_id") !== TILE_ID) return route.continue();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
}

async function expectStats(page: Page) {
  const widget = immichWidget(page);
  await expect(widget).toBeVisible();
  await expect(widget.locator(".immich-stats-widget__stat")).toHaveCount(2);
  await expect(widget.locator(".immich-stats-widget__value")).toHaveText(EXPECTED_VALUES);
}

/**
 * Measures the compact Immich composition rather than trusting hidden
 * overflow: cards, text and stale feedback must all remain inside the fixed
 * 128px tile.
 */
async function assertFits(page: Page) {
  const fit = await immichWidget(page).evaluate((widget) => {
    const tile = widget.closest(".service-tile");
    const grid = widget.querySelector(".immich-stats-widget__grid");
    const notice = widget.querySelector(".immich-stats-widget__stale-error");
    if (!tile || !grid) return null;

    const rect = (element: Element) => {
      const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const contains = (outer: ReturnType<typeof rect>, inner: ReturnType<typeof rect>) =>
      inner.left >= outer.left && inner.right <= outer.right &&
      inner.top >= outer.top && inner.bottom <= outer.bottom;

    const widgetBounds = rect(widget);
    const tileBounds = rect(tile);
    const gridBounds = rect(grid);
    const header = tile.querySelector(".service-tile__header");
    const description = tile.querySelector(".service-tile__description");
    const stats = Array.from(widget.querySelectorAll(".immich-stats-widget__stat"));
    const statBounds = stats.map(rect);
    const statContentsFit = stats.every((stat) => {
      const statBounds = rect(stat);
      return stat.scrollHeight <= stat.clientHeight && stat.scrollWidth <= stat.clientWidth &&
        Array.from(stat.querySelectorAll(
          ".immich-stats-widget__value, .immich-stats-widget__label"
        )).every((child) => contains(statBounds, rect(child)));
    });
    const textBounds = Array.from(widget.querySelectorAll(
      ".immich-stats-widget__value, .immich-stats-widget__label"
    )).map(rect);
    const noticeBounds = notice ? rect(notice) : null;

    return {
      widgetScrolls: widget.scrollHeight > widget.clientHeight || widget.scrollWidth > widget.clientWidth,
      tileHeight: tileBounds.height,
      headerBeforeWidget: header ? rect(header).bottom <= widgetBounds.top : false,
      descriptionInsideHeader: header && description ? contains(rect(header), rect(description)) : true,
      widgetInsideTile: contains(tileBounds, widgetBounds),
      statsInsideWidget: statBounds.every((bounds) => contains(widgetBounds, bounds)),
      statsInsideTile: statBounds.every((bounds) => contains(tileBounds, bounds)),
      statContentsFit,
      textInsideWidget: textBounds.every((bounds) => contains(widgetBounds, bounds)),
      textInsideTile: textBounds.every((bounds) => contains(tileBounds, bounds)),
      statCount: statBounds.length,
      noticeInsideWidget: noticeBounds ? contains(widgetBounds, noticeBounds) : true,
      noticeInsideTile: noticeBounds ? contains(tileBounds, noticeBounds) : true,
      noticeSeparateFromGrid: noticeBounds ? noticeBounds.top >= gridBounds.bottom : true,
    };
  });

  expect(fit, "Immich widget or grid was not rendered").not.toBeNull();
  expect(fit!.statCount).toBe(2);
  expect(fit!.tileHeight).toBe(128);
  expect(fit!.headerBeforeWidget).toBe(true);
  expect(fit!.descriptionInsideHeader).toBe(true);
  expect(fit!.widgetScrolls).toBe(false);
  expect(fit!.widgetInsideTile).toBe(true);
  expect(fit!.statsInsideWidget).toBe(true);
  expect(fit!.statsInsideTile).toBe(true);
  expect(fit!.statContentsFit).toBe(true);
  expect(fit!.textInsideWidget).toBe(true);
  expect(fit!.textInsideTile).toBe(true);
  expect(fit!.noticeInsideWidget).toBe(true);
  expect(fit!.noticeInsideTile).toBe(true);
  expect(fit!.noticeSeparateFromGrid).toBe(true);
}

async function expectAccessibleStatContrast(page: Page) {
  const contrast = await immichWidget(page).evaluate((widget) => {
    const rgb = (color: string) => color.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number);
    const luminance = ([red, green, blue]: number[]) => [red, green, blue]
      .map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      })
      .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const ratio = (foreground: string, background: string) => {
      const fg = rgb(foreground);
      const bg = rgb(background);
      if (!fg || !bg) return null;
      const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
      return (light + 0.05) / (dark + 0.05);
    };

    const entries = Array.from(widget.querySelectorAll(
      ".immich-stats-widget__value, .immich-stats-widget__label"
    )).map((text) => ({
      className: text.className,
      contrast: ratio(
        getComputedStyle(text).color,
        getComputedStyle(text.closest(".immich-stats-widget__stat")!).backgroundColor
      ),
    }));
    return { entries, minimum: Math.min(...entries.map((entry) => entry.contrast ?? 0)) };
  });

  expect(contrast.minimum, JSON.stringify(contrast.entries)).toBeGreaterThanOrEqual(4.5);
}

test("Immich renders its compact stats at its 3x2 footprint across all themes", async ({
  page,
  request,
}) => {
  await mockWidget(page);

  for (const footprint of PILOT_FOOTPRINTS) {
    for (const theme of THEMES) {
      const settingsResponse = await request.patch("/api/settings", {
        data: settingsFor(footprint, { theme }),
      });
      expect(settingsResponse.ok(), `${footprint.label}/${theme} settings update failed`).toBe(true);

      await page.goto("/");
      await expectStats(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(immichTile(page).locator(".service-tile__description")).toHaveText(
        "Private photo and video library"
      );
      await expect(immichTile(page).locator(".service-tile__header .service-tile__description")).toBeVisible();
      const stat = immichWidget(page).locator(".immich-stats-widget__stat").first();
      const valueBounds = await stat.locator(".immich-stats-widget__value").boundingBox();
      const labelBounds = await stat.locator(".immich-stats-widget__label").boundingBox();
      expect(labelBounds!.y).toBeGreaterThanOrEqual(valueBounds!.y + valueBounds!.height);
      await assertFits(page);
      await expectAccessibleStatContrast(page);
      await expect(immichWidget(page).locator(".immich-stats-widget__stat").first()).toHaveCSS(
        "padding-top",
        "6px"
      );
      await expect(immichWidget(page).locator(".immich-stats-widget__stat").first()).toHaveCSS(
        "padding-left",
        "4px"
      );
      await expect(immichWidget(page).locator(".immich-stats-widget__stat").first()).toHaveCSS(
        "border-top-left-radius",
        "8px"
      );
      await expect(immichWidget(page).locator(".immich-stats-widget__value").first()).toHaveCSS(
        "font-size",
        "16px"
      );
      await expect(immichWidget(page).locator(".immich-stats-widget__label").first()).toHaveCSS(
        "font-size",
        "11px"
      );
    }
  }
});

test("Immich initial loading and initial failures use WidgetRenderer states", async ({ page, request }) => {
  const settingsResponse = await request.patch("/api/settings", {
    data: settingsFor(PILOT_FOOTPRINTS[0]),
  });
  expect(settingsResponse.ok()).toBe(true);

  let releaseInitialResponses: (() => void) | undefined;
  const initialResponses = new Promise<void>((resolve) => { releaseInitialResponses = resolve; });
  let returnInitialError = false;
  await page.route("**/api/widget*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("tile_id") !== TILE_ID) return route.continue();
    if (!returnInitialError) {
      await initialResponses;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(STATS_RESPONSE) });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "Immich is unavailable" }),
    });
  });

  await page.goto("/");
  await expect(immichTile(page).locator(".widget-state--loading")).toBeVisible();
  const spinner = immichTile(page).locator(".widget-state__spinner");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(spinner).toHaveCSS("animation-name", "widget-state-spin");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(spinner).toHaveCSS("animation-name", "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(spinner).toHaveCSS("animation-name", "widget-state-spin");
  releaseInitialResponses!();
  await expectStats(page);

  returnInitialError = true;
  await page.reload();
  await expect(immichTile(page).locator(".widget-state--error")).toBeVisible();
  await expect(immichTile(page).locator(".widget-state--error")).toHaveText("Immich is unavailable");
  await expect(immichWidget(page)).toHaveCount(0);
});

test("Immich preserves its blank domain empty state for a successful no-data response", async ({
  page,
  request,
}) => {
  const settingsResponse = await request.patch("/api/settings", {
    data: settingsFor(PILOT_FOOTPRINTS[0]),
  });
  expect(settingsResponse.ok()).toBe(true);
  await mockWidget(page, { ok: true, data: null });

  await page.goto("/");
  const widget = immichWidget(page);
  await expect(widget).toHaveClass(/immich-stats-widget--empty/);
  await expect(widget).toHaveText("");
  await expect(immichTile(page).locator(".widget-state--loading, .widget-state--error")).toHaveCount(0);
});

test("Immich retains full long service text in titles while keeping its compact tile", async ({
  page,
  request,
}) => {
  const name = "Immich media archive with an intentionally long service name";
  const description = "A deliberately long photo and video library description that must not consume widget space";
  const settingsResponse = await request.patch("/api/settings", {
    data: settingsFor(PILOT_FOOTPRINTS[0], {}, { name, description }),
  });
  expect(settingsResponse.ok()).toBe(true);
  await mockWidget(page);

  await page.goto("/");
  const tile = immichTile(page);
  const title = tile.locator(".service-tile__name");
  const subtitle = tile.locator(".service-tile__description");
  await expect(title).toHaveText(name);
  await expect(title).toHaveAttribute("title", name);
  await expect(title).toHaveCSS("white-space", "nowrap");
  await expect(subtitle).toHaveText(description);
  await expect(subtitle).toHaveAttribute("title", description);
  await expect(subtitle).toHaveCSS("white-space", "nowrap");
  await assertFits(page);
});

test("Immich keeps stale stats and shows a separate alert after a refresh failure", async ({
  page,
  request,
}) => {
  let refreshFails = false;
  const error = "Immich rejected the refresh request because its API key is invalid";
  await page.route("**/api/widget*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("tile_id") !== TILE_ID) return route.continue();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(refreshFails ? {
        ok: false,
        error,
      } : STATS_RESPONSE),
    });
  });

  await page.clock.install({ time: new Date("2026-09-20T00:00:00Z") });

  for (const footprint of PILOT_FOOTPRINTS) {
    const settingsResponse = await request.patch("/api/settings", {
      data: settingsFor(footprint),
    });
    expect(settingsResponse.ok(), `${footprint.label} settings update failed`).toBe(true);

    refreshFails = false;
    await page.goto("/");
    await expectStats(page);
    const healthyBounds = await immichLayoutBounds(page);
    refreshFails = true;
    await page.clock.fastForward(60_000);
    const widget = immichWidget(page);
    const alert = widget.getByRole("alert");
    await expect(alert).toHaveText("Refresh failed · saved data");
    await expect(alert).toHaveAttribute("title", error);
    await expect(alert).toHaveAttribute("aria-label", `Refresh failed; saved data is shown. ${error}`);
    await expect(widget.locator(".immich-stats-widget__value")).toHaveText(EXPECTED_VALUES);
    expect(await immichLayoutBounds(page)).toEqual(healthyBounds);
    await assertFits(page);
    refreshFails = false;
    await page.clock.fastForward(60_000);
    await expect(alert).toHaveCount(0);
    await expect(widget.locator(".immich-stats-widget__value")).toHaveText(EXPECTED_VALUES);
    expect(await immichLayoutBounds(page)).toEqual(healthyBounds);
  }
});

test("ordinary custom CSS overrides Immich stat surfaces and values through legacy hooks", async ({
  page,
  request,
}) => {
  const settingsResponse = await request.patch("/api/settings", {
    data: settingsFor(PILOT_FOOTPRINTS[0], {
      custom_css: ".immich-stats-widget__stat { background: #010203; } .immich-stats-widget__value { color: #040506; } .widget-stat-grid { gap: 10px; } .widget-body { --widget-notice-padding-block: 3px; }",
    }),
  });
  expect(settingsResponse.ok()).toBe(true);
  await mockWidget(page);

  await page.goto("/");
  await expectStats(page);
  await expect(immichWidget(page).locator(".immich-stats-widget__stat").first()).toHaveCSS(
    "background-color",
    "rgb(1, 2, 3)"
  );
  await expect(immichWidget(page).locator(".immich-stats-widget__value").first()).toHaveCSS(
    "color",
    "rgb(4, 5, 6)"
  );
  await expect(immichWidget(page).locator(".widget-stat-grid")).toHaveCSS("gap", "10px");
  await expect(immichWidget(page).locator(".widget-body__notice")).toHaveCSS("padding-top", "3px");
  await assertFits(page);
});
