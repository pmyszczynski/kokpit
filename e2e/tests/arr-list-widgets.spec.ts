import { test, expect, type Page, type APIRequestContext, type Locator } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";

const TYPES = ["sonarr-calendar", "sonarr-queue", "radarr-queue"] as const;
const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const FIXTURES = schemaV2Fixtures(TYPES.map((type, index) => ({
  name: ["Sonarr · Calendar", "Sonarr · Queue", "Radarr · Queue"][index],
  description: ["Upcoming episodes", "Episode downloads", "Movie downloads"][index],
  size: "tall", widget: { type, config: { url: `http://localhost:${index === 2 ? 7878 : 8989}`, api_key: "dummy" } },
})));
const CALENDAR = Array.from({ length: 15 }, (_, i) => ({
  id: i + 1, seriesTitle: ["Severance", "The Bear", "Slow Horses", "Silo", "Foundation"][i % 5],
  title: ["The After Hours", "New Beginnings", "The Last Mile", "Into the Deep", "Homecoming"][i % 5],
  airDateUtc: new Date(Date.now() + Math.floor(i / 2) * 86400000).toISOString(),
  seasonNumber: 2, episodeNumber: i + 1, hasFile: i % 3 === 0, monitored: true,
}));
const QUEUE = Array.from({ length: 15 }, (_, i) => ({
  id: i + 1, title: ["Severance.S02E01.1080p", "The.Bear.S03E02", "Slow.Horses.S04E03", "Silo.S02E04", "Foundation.S03E05"][i % 5],
  movieTitle: ["Dune: Part Two", "Interstellar", "Arrival", "The Martian", "Blade Runner 2049"][i % 5],
  seriesTitle: "Severance", size: 1000000000, sizeleft: [270000000, 820000000, 1000000000, 0, 550000000][i % 5],
  status: ["downloading", "paused", "queued", "completed", "downloading"][i % 5],
  trackedDownloadStatus: ["ok", "warning", "error", "ok", "ok"][i % 5],
  timeleft: ["00:04:32", "01:23:45", undefined, "00:00:00", "00:27:14"][i % 5],
}));
const tile = (page: Page, type: string) => page.locator(".service-tile").filter({ has: page.locator(`[data-widget-type="${type}"]`) });
async function configure(request: APIRequestContext, theme = "dark", custom_css?: string, longText = false) {
  expect((await request.patch("/api/settings", { data: {
    ...FIXTURES, services: FIXTURES.services.map(entry => ({ ...entry, ...(longText ? { name: "A deliberately very long service name for media downloads", description: "A long description that must retain the widget's usable content area" } : {}) })),
    groups: [], bookmarks: [], appearance: { theme, custom_css },
  } })).ok()).toBe(true);
}
async function mock(page: Page, calendar: unknown = CALENDAR, queue: unknown = QUEUE) {
  await page.route("**/api/widget*", async route => {
    const id = new URL(route.request().url()).searchParams.get("tile_id");
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: id === FIXTURES.service_tiles[0].id ? calendar : queue }) });
  });
}

async function expectFit(widget: Locator, columns = false) {
  const measured = await widget.evaluate(element => {
    const list = element.querySelector(".widget-list__scroll")!;
    const notice = element.querySelector(".widget-body__notice")!;
    const lr = list.getBoundingClientRect(), nr = notice.getBoundingClientRect(), wr = element.getBoundingClientRect();
    const accessories = Array.from(list.querySelectorAll(".widget-list-item__leading, .widget-list-item__trailing, .widget-list-item__column"));
    const textFits = accessories.every(node => {
      const range = document.createRange(); range.selectNodeContents(node);
      const text = range.getBoundingClientRect(), r = node.getBoundingClientRect();
      return text.left >= r.left - 0.5 && text.right <= r.right + 0.5 && text.top >= r.top - 0.5 && text.bottom <= r.bottom + 0.5;
    });
    const titles = Array.from(list.querySelectorAll(".widget-list-item__content"));
    return { width: wr.width, height: wr.height, noHorizontalScroll: list.scrollWidth <= list.clientWidth,
      noticeAfterList: nr.top >= lr.bottom - 0.5 && nr.bottom <= wr.bottom,
      listInside: lr.left >= wr.left && lr.right <= wr.right && lr.top >= wr.top,
      textFits, scrolling: list.scrollHeight > list.clientHeight,
      titlesAligned: titles.every(node => Math.abs(node.getBoundingClientRect().left - titles[0].getBoundingClientRect().left) < 0.5),
    };
  });
  expect(measured).toEqual({ width: 340, height: 264, noHorizontalScroll: true, noticeAfterList: true, listInside: true, textFits: true, scrolling: true, titlesAligned: true });
  if (columns) {
    const positions = await widget.evaluate(element => {
      const header = Array.from(element.querySelectorAll(".widget-list__columns > span"));
      const row = Array.from(element.querySelector(".widget-list-item")!.children);
      return header.map((node, i) => {
        const h = node.getBoundingClientRect(), r = row[i].getBoundingClientRect();
        return Math.abs(h.left - r.left) < 0.5 && Math.abs(h.width - r.width) < 0.5;
      });
    });
    expect(positions).toEqual([true, true, true, true]);
  }
}

async function expectContrast(widget: Locator) {
  const ratios = await widget.evaluate(element => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    const luminance = (color: string) => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3).map(c => {
        const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    };
    return Array.from(element.querySelectorAll(".widget-badge, .widget-list-item__column, .widget-list-item__leading, .widget-bar__label, .widget-list__columns")).map(node => {
      const style = getComputedStyle(node);
      const background = node.classList.contains("widget-badge") ? style.backgroundColor : getComputedStyle(element).backgroundColor;
      const [a, b] = [luminance(style.color), luminance(background)].sort((a, b) => b - a);
      return (a + 0.05) / (b + 0.05);
    });
  });
  expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
}

test("Arr lists fit four themes with aligned columns, readable fields and keyboard scrolling", async ({ page, request }) => {
  await mock(page);
  for (const theme of THEMES) {
    await configure(request, theme); await page.goto("/");
    for (const type of TYPES) {
      const widget = tile(page, type); await expect(widget.getByRole("listitem")).toHaveCount(15);
      await expectFit(widget, type !== TYPES[0]); await expectContrast(widget);
      const list = widget.getByRole("list"); await list.focus(); await list.press("End");
      await expect.poll(() => list.evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 1)).toBe(true);
      await expect(widget.getByRole("listitem").last()).toBeInViewport();
      await list.press("Home"); await expect.poll(() => list.evaluate(node => node.scrollTop)).toBe(0);
    }
  }
});

test("Arr lists retain full long titles, statuses and ETA without horizontal scrolling", async ({ page, request }) => {
  const fullTitle = "A deliberately very long title for a television episode or movie that needs truncation";
  const release = "A.Very.Long.Release.Title.2160p.WEB-DL.DDP5.1.H.265";
  const status = "Waiting for import with download client unavailable";
  const eta = "2 days, 01:23:45";
  await mock(page, CALENDAR.map(item => ({ ...item, seriesTitle: fullTitle, title: fullTitle })), QUEUE.map(item => ({ ...item, title: release, movieTitle: fullTitle, status, timeleft: eta })));
  await configure(request, "dark", undefined, true); await page.goto("/");
  for (const type of TYPES) {
    const widget = tile(page, type); await expect(widget.getByRole("listitem")).toHaveCount(15); await expectFit(widget, type !== TYPES[0]);
    await expect(widget.locator(".widget-list-item__title").first()).toHaveAttribute("title", type === TYPES[0] ? fullTitle : release);
    if (type === TYPES[0]) await expect(widget.locator(".widget-list-item__secondary").first()).toHaveAttribute("title", `S02E01 · ${fullTitle}`);
    else {
      await expect(widget.locator(`.${type}-widget__status`)).toHaveText(Array(15).fill(status));
      await expect(widget.locator(`.${type}-widget__timeleft`)).toHaveText(Array(15).fill(eta));
    }
    const list = widget.getByRole("list"); await list.focus(); await list.press("End");
    await expect(widget.getByRole("listitem").last()).toBeInViewport();
  }
});

test("Arr list semantics preserve progress boundaries, status priority, dates and missing ETA", async ({ page, request }) => {
  await page.clock.install({ time: new Date("2026-10-05T12:00:00Z") });
  const calendar = CALENDAR.map((item, i) => ({ ...item, airDateUtc: new Date(Date.UTC(2026, 9, 5 + i, 12)).toISOString() }));
  const queue = QUEUE.map((item, i) => i === 0 ? { ...item, size: 0, sizeleft: 0 } : item);
  await mock(page, calendar, queue); await configure(request); await page.goto("/");
  const widget = tile(page, TYPES[0]);
  await expect(widget.locator(".sonarr-calendar-widget__airtime").nth(0)).toHaveText("Today");
  await expect(widget.locator(".sonarr-calendar-widget__airtime").nth(1)).toHaveText("Tomorrow");
  await expect(widget.locator(".sonarr-calendar-widget__badge").nth(0)).toHaveClass(/widget-badge--tone-positive/);
  await expect(widget.locator(".sonarr-calendar-widget__badge").nth(1)).toHaveClass(/widget-badge--tone-info/);
  for (const type of TYPES.slice(1)) {
    const queueWidget = tile(page, type);
    await expect(queueWidget.getByRole("progressbar").nth(0)).toHaveAttribute("aria-valuenow", "0");
    await expect(queueWidget.getByRole("progressbar").nth(3)).toHaveAttribute("aria-valuenow", "100");
    await expect(queueWidget.getByRole("progressbar").nth(1)).toHaveAccessibleName(new RegExp(type === "sonarr-queue" ? "The.Bear" : "Interstellar"));
    await expect(queueWidget.locator(`.${type}-widget__status`).nth(0)).toHaveClass(/tone-neutral/);
    await expect(queueWidget.locator(`.${type}-widget__status`).nth(1)).toHaveClass(/tone-warning/);
    await expect(queueWidget.locator(`.${type}-widget__status`).nth(2)).toHaveClass(/tone-alert/);
    await expect(queueWidget.locator(`.${type}-widget__timeleft`).nth(2)).toHaveText("—");
  }
});

test("Arr initial loading, errors, null and empty data retain shared states and scoped CSS hooks", async ({ page, request }) => {
  const css = TYPES.map(type => `.${type}-widget__hint { padding-top:7px; } .${type}-widget--empty .${type}-widget__hint { padding-bottom:9px; } .${type}-widget--empty .${type}-widget__hint--error { color:#040506; }`).join("\n");
  await configure(request, "dark", css);
  let release!: () => void; const initial = new Promise<void>(resolve => { release = resolve; });
  let response: unknown = { ok: false, error: "Download service unavailable" };
  await page.route("**/api/widget*", async route => { await initial; await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) }); });
  await page.goto("/");
  for (const type of TYPES) {
    const loading = tile(page, type).getByRole("status", { name: "Loading widget" });
    await expect(loading).toHaveCSS("padding-top", "7px"); await expect(loading).toHaveCSS("padding-bottom", "9px");
  }
  release();
  for (const type of TYPES) {
    await expect(tile(page, type).getByRole("alert")).toHaveText("Download service unavailable");
    await expect(tile(page, type).locator(".widget-state__label")).toHaveCSS("color", "rgb(4, 5, 6)");
  }
  response = { ok: true, data: null }; await page.reload();
  for (const type of TYPES) { await expect(tile(page, type).locator(`.${type}-widget--empty`)).toBeVisible(); await expect(tile(page, type).getByRole("list")).toHaveCount(0); }
  response = { ok: true, data: [] }; await page.reload();
  for (const type of TYPES) {
    const empty = tile(page, type).getByText(type === TYPES[0] ? "No upcoming episodes" : "Queue is empty");
    await expect(empty).toHaveCSS("padding-top", "7px"); await expect(empty).toHaveCSS("padding-bottom", "9px");
    await expect(tile(page, type).getByRole("list")).toHaveCount(0);
  }
});

for (const empty of [false, true]) test(`Arr saved ${empty ? "empty" : "populated"} lists retain bounds and scroll through refresh failure/recovery`, async ({ page, request }, testInfo) => {
  let fails = false;
  await page.route("**/api/widget*", async route => {
    const id = new URL(route.request().url()).searchParams.get("tile_id");
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(fails ? { ok: false, error: "Connection lost" } : { ok: true, data: empty ? [] : id === FIXTURES.service_tiles[0].id ? CALENDAR : QUEUE }) });
  });
  await page.clock.install();
  for (const theme of THEMES) {
    fails = false; await configure(request, theme); await page.goto("/");
    for (const type of TYPES) {
      const widget = tile(page, type);
      await expect(widget.locator(empty ? ".widget-state--empty" : ".widget-list-item")).toHaveCount(empty ? 1 : 15);
      if (!empty) await widget.getByRole("list").evaluate(node => { node.scrollTop = 45; });
    }
    const bounds = async () => Promise.all(TYPES.map(type => tile(page, type).locator(".widget-list,.widget-body__notice").evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }))));
    const scrolls = async () => Promise.all(TYPES.map(type => tile(page, type).locator(".widget-list__scroll").evaluateAll(nodes => nodes.map(node => node.scrollTop))));
    const healthy = await bounds(), offsets = await scrolls();
    fails = true; await page.clock.fastForward(15000);
    for (const type of TYPES.slice(1)) await expect(tile(page, type).getByRole("alert")).toHaveAccessibleName("Refresh failed; saved data is shown. Connection lost");
    await expect(tile(page, TYPES[0]).getByRole("alert")).toHaveCount(0);
    await page.clock.fastForward(45000);
    for (const type of TYPES) await expect(tile(page, type).getByRole("alert")).toHaveAccessibleName("Refresh failed; saved data is shown. Connection lost");
    expect(await bounds()).toEqual(healthy); expect(await scrolls()).toEqual(offsets);
    if (!empty && theme === "dark") await testInfo.attach("Arr stale", { body: await page.locator(".dashboard-tile-grid").screenshot({ path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/stale-dark.png` : undefined }), contentType: "image/png" });
    fails = false; await page.clock.fastForward(60000);
    for (const type of TYPES) await expect(tile(page, type).getByRole("alert")).toHaveCount(0);
    expect(await bounds()).toEqual(healthy); expect(await scrolls()).toEqual(offsets);
  }
});

test("Arr shared list cells, badge and bar respect ordinary custom CSS", async ({ page, request }) => {
  await configure(request, "dark", `.sonarr-calendar-widget__row { padding-top:10px; } .sonarr-calendar-widget__badge { color:#040506; } .sonarr-queue-widget__progress-bar, .radarr-queue-widget__progress-bar { height:7px; } .sonarr-queue-widget__progress-fill, .radarr-queue-widget__progress-fill { background:#112233; } .sonarr-queue-widget__status, .radarr-queue-widget__status { color:#040506; }`);
  await mock(page); await page.goto("/");
  await expect(tile(page, TYPES[0]).getByRole("listitem").first()).toHaveCSS("padding-top", "10px");
  await expect(tile(page, TYPES[0]).locator(".widget-badge").first()).toHaveCSS("color", "rgb(4, 5, 6)");
  for (const type of TYPES.slice(1)) {
    await expect(tile(page, type).getByRole("progressbar").first()).toHaveCSS("height", "7px");
    await expect(tile(page, type).locator(".widget-bar__fill").first()).toHaveCSS("background-color", "rgb(17, 34, 51)");
    await expect(tile(page, type).locator(`.${type}-widget__status`).first()).toHaveCSS("color", "rgb(4, 5, 6)");
  }
});

test("Arr list comparison previews", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1108, height: 460 });
  await mock(page);
  for (const theme of ["dark", "light"]) {
    await configure(request, theme); await page.goto("/");
    for (const type of TYPES) await expect(tile(page, type).locator(`.${type}-widget__row`)).toHaveCount(15);
    await testInfo.attach(`Arr lists ${theme}`, { body: await page.locator(".dashboard-tile-grid").screenshot({
      path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/comparison-${theme}.png` : undefined,
    }), contentType: "image/png" });
  }
});
