import { test, expect, type Page, type APIRequestContext, type Locator } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";

const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const FIXTURES = schemaV2Fixtures([
  { name: "qBittorrent · Stats", description: "Transfer overview", size: "tall", widget: { type: "qbittorrent-stats", config: { url: "http://localhost:8080", username: "admin", password: "dummy" } } },
  { name: "qBittorrent · Torrents", description: "Downloads and seeding", size: "tall", widget: { type: "qbittorrent-torrents", config: { url: "http://localhost:8080", username: "admin", password: "dummy" } } },
  { name: "Sonarr · Queue", description: "Episode downloads", size: "tall", widget: { type: "sonarr-queue", config: { url: "http://localhost:8989", api_key: "dummy" } } },
]);
const TORRENTS = Array.from({ length: 15 }, (_, i) => ({
  hash: `torrent-${i}`, name: ["Ubuntu 26.04 Desktop", "Fedora Workstation", "Debian 13", "Linux Mint", "Arch Linux"][i % 5],
  progress: [0.73, 0.18, 0, 1, 0.45][i % 5], dlspeed: [12_000_000, 850_000, 0, 0, 2_400_000][i % 5], upspeed: [240_000, 0, 0, 1_000_000, 150_000][i % 5],
}));
const STATS = { dl_info_speed: 15_250_000, up_info_speed: 1_390_000, dl_info_data: 987_654_300_000, up_info_data: 123_450_000_000, activity: { active: 12, inactive: 3 } };
const QUEUE = TORRENTS.map((t, i) => ({ id: i, title: ["Severance.S02E01.1080p", "The.Bear.S03E02", "Slow.Horses.S04E03", "Silo.S02E04", "Foundation.S03E05"][i % 5], size: 1000000000, sizeleft: Math.round((1 - t.progress) * 1000000000), status: ["downloading", "paused", "queued", "completed", "downloading"][i % 5], trackedDownloadStatus: "ok", timeleft: "00:04:32" }));
const tile = (page: Page, type = "qbittorrent-torrents") => page.locator(".service-tile").filter({ has: page.locator(`[data-widget-type="${type}"]`) });
async function configure(request: APIRequestContext, theme = "dark", custom_css?: string, longText = false) {
  expect((await request.patch("/api/settings", { data: { ...FIXTURES, groups: [], bookmarks: [], appearance: { theme, custom_css },
    services: FIXTURES.services.map(s => ({ ...s, ...(longText ? { name: "A deliberately very long qBittorrent service name", description: "A long description retaining the usable content area" } : {}) })),
  } })).ok()).toBe(true);
}
async function mock(page: Page, torrents: unknown = TORRENTS) {
  await page.route("**/api/widget*", async route => {
    const id = new URL(route.request().url()).searchParams.get("tile_id");
    const data = id === FIXTURES.service_tiles[0].id ? STATS : id === FIXTURES.service_tiles[1].id ? torrents : QUEUE;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  });
}

async function expectFit(widget: Locator) {
  const measured = await widget.evaluate(element => {
    const list = element.querySelector(".widget-list__scroll")!;
    const notice = element.querySelector(".widget-body__notice")!;
    const wr = element.getBoundingClientRect(), lr = list.getBoundingClientRect(), nr = notice.getBoundingClientRect();
    const header = Array.from(element.querySelectorAll(".widget-list__columns > span"));
    const rows = Array.from(element.querySelectorAll(".widget-list-item"));
    return {
      width: wr.width, height: wr.height,
      noHorizontalScroll: list.scrollWidth <= list.clientWidth,
      noticeInside: nr.top >= lr.bottom - 0.5 && nr.bottom <= wr.bottom,
      listInside: lr.left >= wr.left && lr.right <= wr.right && lr.top >= wr.top,
      columnsAligned: rows.every(row => Array.from(row.children).every((node, i) => {
        const r = node.getBoundingClientRect(), h = header[i].getBoundingClientRect();
        return Math.abs(r.left - h.left) < 0.5 && Math.abs(r.width - h.width) < 0.5;
      })),
      textFits: rows.every(row => Array.from(row.querySelectorAll(".widget-list-item__column")).every(node => {
        const range = document.createRange(); range.selectNodeContents(node);
        const text = range.getBoundingClientRect(), r = node.getBoundingClientRect();
        return text.left >= r.left - 0.5 && text.right <= r.right + 0.5 && text.top >= r.top - 0.5 && text.bottom <= r.bottom + 0.5;
      })),
    };
  });
  expect(measured).toEqual({ width: 340, height: 264, noHorizontalScroll: true, noticeInside: true, listInside: true, columnsAligned: true, textFits: true });
}

test("qBittorrent torrents fit four themes, match shared transfer colors and reach every row by keyboard", async ({ page, request }) => {
  await mock(page);
  for (const theme of THEMES) {
    await configure(request, theme); await page.goto("/");
    const widget = tile(page); await expect(widget.getByRole("listitem")).toHaveCount(15);
    await expectFit(widget);
    const colors = await widget.evaluate(element => {
      const stats = document.querySelector('[data-widget-type="qbittorrent-stats"]')!;
      const speeds = element.querySelectorAll(".qbt-torrents-widget__speed");
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      const luminance = (color: string) => {
        ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3).map(c => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      };
      const background = luminance(getComputedStyle(element).backgroundColor);
      return {
        downloadMatches: getComputedStyle(speeds[0]).color === getComputedStyle(stats.querySelector(".widget-stat--tone-positive .widget-stat__value")!).color,
        uploadMatches: getComputedStyle(speeds[1]).color === getComputedStyle(stats.querySelector(".widget-stat--tone-info .widget-stat__value")!).color,
        zeroNeutral: getComputedStyle(speeds[3]).color === getComputedStyle(element.querySelector(".widget-list__columns")!).color,
        contrast: Array.from(element.querySelectorAll(".widget-list-item__title,.widget-list-item__column,.widget-bar__label,.widget-list__columns")).map(node => {
          const [a, b] = [luminance(getComputedStyle(node).color), background].sort((a, b) => b - a); return (a + 0.05) / (b + 0.05);
        }),
      };
    });
    expect(colors.downloadMatches).toBe(true); expect(colors.uploadMatches).toBe(true); expect(colors.zeroNeutral).toBe(true);
    expect(Math.min(...colors.contrast)).toBeGreaterThanOrEqual(4.5);
    const list = widget.getByRole("list", { name: "qBittorrent torrents" });
    await list.focus(); await list.press("End");
    await expect.poll(() => list.evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 1)).toBe(true);
    await expect(widget.getByRole("listitem").last()).toBeInViewport();
    await list.press("Home"); await expect.poll(() => list.evaluate(node => node.scrollTop)).toBe(0);
  }
});

test("qBittorrent torrents retain long names, large formatted rates and bounded domain progress", async ({ page, request }) => {
  const name = "A very long distribution name including version, architecture and release details";
  const progress = [-0.1, 0, 0.734, 1, 1.205];
  await mock(page, TORRENTS.map((t, i) => ({ ...t, name, progress: progress[i % 5], dlspeed: 999_900_000, upspeed: 123_450_000 })));
  await configure(request, "dark", undefined, true); await page.goto("/");
  const widget = tile(page); await expect(widget.getByRole("listitem")).toHaveCount(15);
  await expectFit(widget);
  await expect(widget.locator(".qbt-torrents-widget__name").first()).toHaveAttribute("title", name);
  await expect(widget.locator(".qbt-torrents-widget__speed").nth(0)).toHaveText("999.9 MB/s");
  await expect(widget.locator(".qbt-torrents-widget__speed").nth(1)).toHaveText("123.5 MB/s");
  const bars = widget.getByRole("progressbar");
  for (const [i, domain] of [-10, 0, 73, 100, 121].entries()) {
    await expect(bars.nth(i)).toHaveAccessibleName(`Download progress for ${name}`);
    await expect(bars.nth(i)).toHaveAttribute("aria-valuenow", String(Math.min(100, Math.max(0, domain))));
    await expect(bars.nth(i)).toHaveAttribute("aria-valuetext", `${domain}%`);
  }
  const measurements = await bars.evaluateAll(nodes => nodes.map((node, index) => ({ index, actual: node.firstElementChild!.getBoundingClientRect().width / node.getBoundingClientRect().width * 100, expected: Number(node.getAttribute("aria-valuenow")) })));
  expect(measurements).toHaveLength(15);
  for (const measurement of measurements) expect(measurement.actual, JSON.stringify(measurement)).toBeCloseTo(measurement.expected, 1);
});

test("qBittorrent torrent comparison previews", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1108, height: 460 });
  await mock(page);
  for (const theme of ["dark", "light"]) {
    await configure(request, theme); await page.goto("/");
    await expect(tile(page).locator(".qbt-torrents-widget__row")).toHaveCount(15);
    await expect(tile(page, "qbittorrent-stats").locator(".widget-stat")).toHaveCount(6);
    await expect(tile(page, "sonarr-queue").getByRole("listitem")).toHaveCount(15);
    await testInfo.attach(`qBittorrent torrents ${theme}`, { body: await page.locator(".dashboard-tile-grid").screenshot({
      path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/comparison-${theme}.png` : undefined,
    }), contentType: "image/png" });
  }
});

test("qBittorrent initial loading, error, null and empty states preserve scoped custom CSS", async ({ page, request }) => {
  await configure(request, "dark", `.qbt-torrents-widget__hint { padding-top:7px; } .qbt-torrents-widget--empty .qbt-torrents-widget__hint { padding-bottom:9px; } .qbt-torrents-widget--empty .qbt-torrents-widget__hint--error { color:#040506; }`);
  let release!: () => void; const initial = new Promise<void>(resolve => { release = resolve; });
  let response: unknown = { ok: false, error: "qBittorrent unavailable" };
  await page.route("**/api/widget*", async route => { await initial; await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) }); });
  await page.goto("/");
  const widget = tile(page), loading = widget.getByRole("status", { name: "Loading widget" });
  await expect(loading).toHaveCSS("padding-top", "7px"); await expect(loading).toHaveCSS("padding-bottom", "9px");
  release(); await expect(widget.getByRole("alert")).toHaveText("qBittorrent unavailable");
  await expect(widget.locator(".widget-state__label")).toHaveCSS("color", "rgb(4, 5, 6)");
  response = { ok: true, data: null }; await page.reload();
  await expect(widget.locator(".qbt-torrents-widget--empty")).toBeVisible(); await expect(widget.getByRole("list")).toHaveCount(0);
  response = { ok: true, data: [] }; await page.reload();
  await expect(widget.getByText("No torrents")).toHaveCSS("padding-bottom", "9px");
  await expect(widget.getByRole("list")).toHaveCount(0); await expect(widget.locator(".widget-list__columns")).toHaveCount(0);
});

for (const empty of [false, true]) test(`qBittorrent saved ${empty ? "empty" : "populated"} torrents retain bounds through 15-second refresh failure and recovery`, async ({ page, request }, testInfo) => {
  let fails = false;
  await page.route("**/api/widget*", async route => {
    const id = new URL(route.request().url()).searchParams.get("tile_id");
    const data = id === FIXTURES.service_tiles[0].id ? STATS : id === FIXTURES.service_tiles[1].id ? empty ? [] : TORRENTS : QUEUE;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(id === FIXTURES.service_tiles[1].id && fails ? { ok: false, error: "Connection lost" } : { ok: true, data }) });
  });
  await page.clock.install();
  for (const theme of THEMES) {
    fails = false; await configure(request, theme); await page.goto("/");
    const widget = tile(page);
    await expect(widget.locator(empty ? ".widget-state--empty" : ".widget-list-item")).toHaveCount(empty ? 1 : 15);
    if (!empty) await widget.getByRole("list").evaluate(node => { node.scrollTop = 45; });
    const bounds = () => widget.locator(".widget-list,.widget-body__notice").evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    const scrolls = () => widget.locator(".widget-list__scroll").evaluateAll(nodes => nodes.map(node => node.scrollTop));
    const healthy = await bounds(), offsets = await scrolls();
    fails = true; await page.clock.fastForward(15000);
    await expect(widget.getByRole("alert")).toHaveAccessibleName("Refresh failed; saved data is shown. Connection lost");
    expect(await bounds()).toEqual(healthy); expect(await scrolls()).toEqual(offsets);
    if (empty) await expect(widget.getByRole("list")).toHaveCount(0);
    if (!empty && theme === "dark") await testInfo.attach("qBittorrent stale", { body: await widget.screenshot({ path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/stale-dark.png` : undefined }), contentType: "image/png" });
    fails = false; await page.clock.fastForward(15000); await expect(widget.getByRole("alert")).toHaveCount(0);
    expect(await bounds()).toEqual(healthy); expect(await scrolls()).toEqual(offsets);
    if (empty) await expect(widget.getByRole("list")).toHaveCount(0);
  }
});

test("qBittorrent list and progress styles respect ordinary custom CSS", async ({ page, request }) => {
  await configure(request, "dark", `.qbt-torrents-widget { --widget-list-column-template:minmax(0,1fr) 68px 70px 62px; --widget-list-item-gap:9px; } .qbt-torrents-widget__row { padding-top:10px; } .qbt-torrents-widget__speed { color:#040506; } .qbt-torrents-widget__progress-bar { height:7px; } .qbt-torrents-widget__progress-fill { width:11px; background:#112233; }`);
  await mock(page); await page.goto("/");
  const widget = tile(page); await expect(widget.getByRole("listitem")).toHaveCount(15); await expectFit(widget);
  await expect(widget.getByRole("listitem").first()).toHaveCSS("padding-top", "10px");
  await expect(widget.getByRole("listitem").first()).toHaveCSS("column-gap", "9px");
  await expect(widget.locator(".widget-list__columns")).toHaveCSS("column-gap", "9px");
  await expect(widget.locator(".qbt-torrents-widget__speed").first()).toHaveCSS("color", "rgb(4, 5, 6)");
  await expect(widget.getByRole("progressbar").first()).toHaveCSS("height", "7px");
  await expect(widget.locator(".qbt-torrents-widget__progress-fill").first()).toHaveCSS("width", "11px");
  await expect(widget.locator(".qbt-torrents-widget__progress-fill").first()).toHaveCSS("background-color", "rgb(17, 34, 51)");
});
