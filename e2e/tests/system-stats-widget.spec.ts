import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";
import { expectWidgetStatLayout, expectWidgetStatContrast } from "../helpers/widget-stat";
import type { SystemStatsData } from "../../src/integrations/systemstats/api";

const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const BASE_FIXTURES = schemaV2Fixtures([
  { name: "System · Compact", description: "CPU and memory", size: "normal", widget: { type: "system-stats" } },
  { name: "System · Detailed", description: "All six host fields", size: "tall", widget: { type: "system-stats" } },
  { name: "System · Wide", description: "CPU, memory and disk", size: "wide", widget: { type: "system-stats" } },
  { name: "qBittorrent · Compact", description: "Shared card reference", size: "normal", widget: { type: "qbittorrent-stats", config: { url: "http://localhost:8080", username: "admin", password: "dummy" } } },
]);
const FIXTURES = { ...BASE_FIXTURES, service_tiles: BASE_FIXTURES.service_tiles.map((t, i) => i < 3 ? { ...t, widget: { ...t.widget!, config: { size_defaults: true } } } : t) };
const REFERENCE_DATA = { dl_info_speed: 5500000, up_info_speed: 500000, dl_info_data: 0, up_info_data: 0, activity: { active: 1, inactive: 0 } };
const DATA: SystemStatsData = {
  cpu: { usagePercent: 12.4, cores: 8 },
  memory: { total: 16 * 1024 ** 3, used: 3435973837, available: 16 * 1024 ** 3 - 3435973837, usagePercent: 20 },
  disk: { path: "/", total: 500 * 1024 ** 3, used: 120 * 1024 ** 3, available: 380 * 1024 ** 3, usagePercent: 24 },
  network: { rxBytesPerSec: 1200000, txBytesPerSec: 240000, interfaces: ["eth0"] },
  load: { one: 0.42, five: 0.55, fifteen: 0.6, cores: 8 },
  docker: { running: 8, total: 12 }, dockerError: null,
};
const EMPTY_DATA: SystemStatsData = { cpu: null, memory: null, disk: null, network: null, load: null, docker: null, dockerError: null };
const tile = (page: Page, index = 0) => page.locator(".service-tile").filter({ has: page.locator('[data-widget-type="system-stats"]') }).nth(index);
async function configure(request: APIRequestContext, theme = "dark", custom_css?: string, longText = false, showcase = false) {
  expect((await request.patch("/api/settings", { data: { ...FIXTURES, service_tiles: showcase ? [0, 2, 1, 3].map(i => FIXTURES.service_tiles[i]) : FIXTURES.service_tiles, groups: [], bookmarks: [], appearance: { theme, custom_css },
    services: FIXTURES.services.map(s => ({ ...s, ...(longText ? { name: "System Stats with a deliberately very long service name", description: "A long description of this host and its optional resources" } : {}) })),
  } })).ok()).toBe(true);
}
async function mock(page: Page, data: SystemStatsData = DATA) {
  await page.route("**/api/widget*", async route => {
    const id = new URL(route.request().url()).searchParams.get("tile_id");
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: id === FIXTURES.service_tiles[3].id ? REFERENCE_DATA : id === FIXTURES.service_tiles[0].id ? { ...EMPTY_DATA, cpu: data.cpu, memory: data.memory } : id === FIXTURES.service_tiles[2].id ? { ...EMPTY_DATA, cpu: data.cpu, memory: data.memory, disk: data.disk } : data }) });
  });
}

test("System Stats 2/3/6 size comparison previews", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1108, height: 720 }); await mock(page);
  for (const theme of ["dark", "light"]) {
    await configure(request, theme, undefined, false, true); await page.goto("/");
    await expect(page.locator('.system-stats-widget[data-footprint="3x2"] .widget-stat')).toHaveCount(2);
    await expect(page.locator('.system-stats-widget[data-footprint="6x2"] .widget-stat')).toHaveCount(3);
    await expect(page.locator('.system-stats-widget[data-footprint="3x4"] .widget-stat-row')).toHaveCount(6);
    await testInfo.attach(`System Stats sizes ${theme}`, { body: await page.locator(".dashboard-tile-grid").screenshot({ path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/sizes-${theme}.png` : undefined }), contentType: "image/png" });
  }
});

async function expectFit(widget: ReturnType<typeof tile>, standard = false) {
  const measured = await widget.evaluate(element => {
    const body = element.querySelector(".widget-body")!, content = element.querySelector(".widget-body__content")!, notice = element.querySelector(".widget-body__notice")!;
    const wr = element.getBoundingClientRect(), br = body.getBoundingClientRect(), cr = content.getBoundingClientRect(), nr = notice.getBoundingClientRect();
    const within = (outer: DOMRect, inner: DOMRect) => inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
    const textNodes = Array.from(element.querySelectorAll(".widget-stat-row__label,.widget-stat-row__value,.widget-stat-row__subvalue,.widget-stat-row__detail"));
    return { width: wr.width, height: wr.height, bodyContained: within(wr, br), contentContained: within(br, cr), noticeContained: within(br, nr), noticeAfterContent: nr.top >= cr.bottom - 0.5,
      noHorizontalScroll: content.scrollWidth <= content.clientWidth,
      rowsContained: Array.from(content.querySelectorAll(".widget-stat-row")).every(row => { const r = row.getBoundingClientRect(); return r.left >= cr.left && r.right <= cr.right; }),
      textContained: textNodes.every(node => { const range = document.createRange(); range.selectNodeContents(node); const r = node.getBoundingClientRect(); return Array.from(range.getClientRects()).every(rect => within(r, rect)); }),
      textOverflow: textNodes.flatMap(node => { const range = document.createRange(); range.selectNodeContents(node); const r = node.getBoundingClientRect(); return Array.from(range.getClientRects()).filter(rect => !within(r, rect)).map(rect => ({ text: node.textContent, className: node.className, parent: { x:r.x,y:r.y,width:r.width,height:r.height }, textBounds:{ x:rect.x,y:rect.y,width:rect.width,height:rect.height } })); }),
      verticalScroll: content.scrollHeight > content.clientHeight + 1,
    };
  });
  const { verticalScroll, textOverflow, ...bounds } = measured;
  expect(bounds, JSON.stringify(textOverflow)).toEqual({ width: 340, height: 264, bodyContained: true, contentContained: true, noticeContained: true, noticeAfterContent: true, noHorizontalScroll: true, rowsContained: true, textContained: true });
  if (standard) expect(verticalScroll).toBe(false);
}

async function expectContrast(widget: ReturnType<typeof tile>) {
  const colors = await widget.evaluate(element => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1; const ctx = canvas.getContext("2d")!;
    const luminance = (color: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3).map(c => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0); };
    const background = luminance(getComputedStyle(element).backgroundColor);
    const ratio = (color: string) => { const [a, b] = [luminance(color), background].sort((a, b) => b - a); return (a + 0.05) / (b + 0.05); };
    return { text: Array.from(element.querySelectorAll(".widget-stat-row__label,.widget-stat-row__value,.widget-stat-row__subvalue,.widget-stat-row__detail")).map(n => ratio(getComputedStyle(n).color)),
      meters: Array.from(element.querySelectorAll(".widget-bar__fill")).map(n => ratio(getComputedStyle(n).backgroundColor)) };
  });
  expect(Math.min(...colors.text)).toBeGreaterThanOrEqual(4.5);
  if (colors.meters.length) expect(Math.min(...colors.meters)).toBeGreaterThanOrEqual(3);
}

test("System Stats fits 2/3/6 fields across all three footprints with readable shared colors in every theme", async ({ page, request }) => {
  await page.setViewportSize({ width: 1108, height: 720 }); await mock(page);
  for (const theme of THEMES) {
    await configure(request, theme); await page.goto("/");
    const compact = tile(page), wide = tile(page, 2), widget = tile(page, 1);
    await expect(compact.locator(".widget-stat__label")).toHaveText(["CPU", "Memory"]);
    await expect(wide.locator(".widget-stat__label")).toHaveText(["CPU", "Memory", "Disk"]);
    await expectWidgetStatLayout(compact, { width: 340, height: 128, columns: 2, rows: 1 });
    await expectWidgetStatLayout(wide, { width: 688, height: 128, columns: 3, rows: 1 });
    await expectWidgetStatContrast(compact); await expectWidgetStatContrast(wide);
    await expect(compact.locator(".system-stats-widget__stat--memory .widget-stat__value")).toHaveAccessibleDescription("3.2 / 16 GiB (20%); 12.8 GiB available");
    await expect(widget.locator(".widget-stat-row")).toHaveCount(6); await expectFit(widget, true); await expectContrast(widget);
    await expect(widget.getByRole("meter")).toHaveCount(3);
    await expect(widget.getByRole("progressbar")).toHaveCount(0);
    await expect(widget.getByRole("meter", { name: "CPU usage" })).toHaveAttribute("aria-valuetext", "12%");
    await expect(widget.getByRole("meter", { name: "Memory usage" })).toHaveAttribute("aria-valuetext", "3.2 / 16 GiB (20%)");
    await expect(widget.locator(".system-stats-widget__row-label")).toHaveText(["CPU", "Memory", "Disk (/)", "Network", "Load", "Docker"]);
    const region = widget.getByRole("region", { name: "System stats measurements" }); await region.focus(); await expect(region).toBeFocused();
    await expect(widget.locator(".system-stats-widget__net-rate").first()).toHaveClass(/value--tone-positive/);
    await expect(widget.locator(".system-stats-widget__net-rate").last()).toHaveClass(/value--tone-info/);
    await expect(widget.getByText("0.42", { exact: true })).toHaveAttribute("title", "1-minute load average");
    const reference = page.locator('[data-widget-type="qbittorrent-stats"] .widget-stat').first();
    const cardStyle = (node: Element) => { const r = node.getBoundingClientRect(), style = getComputedStyle(node); return { width:r.width, height:r.height, padding:style.padding, gap:style.gap, valueSize:getComputedStyle(node.querySelector(".widget-stat__value")!).fontSize, labelSize:getComputedStyle(node.querySelector(".widget-stat__label")!).fontSize }; };
    expect(await compact.locator(".widget-stat").first().evaluate(cardStyle)).toEqual(await reference.evaluate(cardStyle));
  }
});

test("System Stats supporting details work with keyboard focus, Escape and hover without moving cards", async ({ page, request }) => {
  const path = "/mnt/long-host-filesystem-name/containers-and-media-storage/production-volume";
  await page.setViewportSize({ width: 1108, height: 720 });
  await mock(page, { ...DATA, disk: { ...DATA.disk!, path } });
  for (const theme of THEMES) {
    await configure(request, theme); await page.goto("/");
    const values = [tile(page).locator(".system-stats-widget__stat--memory .widget-stat__value"), tile(page, 2).locator(".system-stats-widget__stat--disk .widget-stat__value")];
    for (const value of values) {
      const card = value.locator("..");
      const before = await card.boundingBox();
      await expect(value).toHaveAttribute("tabindex", "0");
      await value.focus(); await expect(value).toBeFocused();
      const tooltip = page.getByRole("tooltip");
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText(value === values[0] ? "3.2 / 16 GiB" : path);
      const bounds = await tooltip.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1108); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(720);
      expect(await card.boundingBox()).toEqual(before);
      await value.press("Escape"); await expect(tooltip).toHaveCount(0); await expect(value).toBeFocused();
      await page.keyboard.press("Tab"); await expect(value).not.toBeFocused();
      await value.hover(); await expect(tooltip).toBeVisible();
      await page.mouse.move(1000, 700); await expect(tooltip).toHaveCount(0);
    }
    await configure(request, theme, ".widget-stat__tooltip { left:12px; top:180px; background-color:#ffffff; color:#000000; }");
    await page.goto("/");
    await tile(page).locator(".system-stats-widget__stat--memory .widget-stat__value").focus();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toHaveCSS("left", "12px"); await expect(tooltip).toHaveCSS("top", "180px");
    await expect(tooltip).toHaveCSS("background-color", "rgb(255, 255, 255)"); await expect(tooltip).toHaveCSS("color", "rgb(0, 0, 0)");
  }
});

test("System Stats keeps long paths and large formatted values readable and keyboard reachable", async ({ page, request }) => {
  const path = "/mnt/very-long-host-filesystem-name/containers-and-media-storage/production-volume";
  const data = { ...DATA, disk: { ...DATA.disk!, path, total: 1234567890 * 1024 ** 3, used: 987654321 * 1024 ** 3 },
    network: { ...DATA.network!, rxBytesPerSec: 1234567890123456, txBytesPerSec: 987654321098765 },
    load: { ...DATA.load!, one: 123456789012.34, five: 987654321098.76, fifteen: 123456789098.76 },
    docker: { running: 123456789012, total: 987654321098 } };
  await mock(page, data);
  for (const theme of THEMES) {
    await configure(request, theme, undefined, true); await page.goto("/");
    const widget = tile(page, 1); await expect(widget.locator(".widget-stat-row")).toHaveCount(6); await expectFit(widget);
    await expect(widget.getByText(`Disk (${path})`, { exact: true })).toBeVisible();
    await expect(widget.locator(".system-stats-widget__row-value").nth(2)).toHaveText("987654321 / 1234567890 GiB (24%)");
    const region = widget.getByRole("region", { name: "System stats measurements" }); await region.focus(); await region.press("End");
    await expect.poll(() => region.evaluate(node => node.scrollTop + node.clientHeight >= node.scrollHeight - 1)).toBe(true);
    await expect(widget.getByText("123456789012 / 987654321098 running")).toBeInViewport();
    await region.press("Home"); await expect.poll(() => region.evaluate(node => node.scrollTop)).toBe(0);
  }
});

test("System Stats separates zero transfer activity, bounded meters and partial Docker errors", async ({ page, request }) => {
  const data = { ...DATA, cpu: { ...DATA.cpu!, usagePercent: 120 }, memory: { ...DATA.memory!, usagePercent: -20 },
    disk: { ...DATA.disk!, usagePercent: 100 }, network: { ...DATA.network!, rxBytesPerSec: 0, txBytesPerSec: 0 },
    docker: null, dockerError: "Docker socket permission denied" };
  await mock(page, data);
  for (const theme of THEMES) {
    await configure(request, theme); await page.goto("/");
    const widget = tile(page, 1); await expect(widget.locator(".widget-stat-row")).toHaveCount(6); await expectFit(widget); await expectContrast(widget);
    await expect(widget.getByText("120%", { exact: true })).toBeVisible();
    await expect(widget.getByRole("meter", { name: "CPU usage" })).toHaveAttribute("aria-valuenow", "100");
    await expect(widget.getByRole("meter", { name: "CPU usage" })).toHaveAttribute("aria-valuetext", "120%");
    await expect(widget.getByRole("meter", { name: "Memory usage" })).toHaveAttribute("aria-valuenow", "0");
    await expect(widget.getByRole("meter", { name: "Memory usage" })).toHaveAttribute("aria-valuetext", "3.2 / 16 GiB (-20%)");
    await expect(widget.locator(".widget-bar").nth(0)).toHaveCSS("--widget-bar-value", "100%");
    await expect(widget.locator(".widget-bar").nth(1)).toHaveCSS("--widget-bar-value", "0%");
    for (const text of ["↓ 0 B/s", "↑ 0 B/s"]) await expect(widget.getByText(text, { exact: true })).toHaveClass(/value--tone-neutral/);
    await expect(widget.getByText("Docker unavailable")).toHaveAttribute("title", data.dockerError);
    await expect(widget.getByRole("alert")).toHaveCount(0);
  }
});

test("System Stats preserves optional-only rows and a Docker-only collection failure", async ({ page, request }) => {
  let data: SystemStatsData = { ...EMPTY_DATA, load: DATA.load, dockerError: "Socket not mounted" };
  await page.route("**/api/widget*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) }));
  await configure(request); await page.goto("/"); const widget = tile(page, 1);
  await expect(widget.locator(".widget-stat-row")).toHaveCount(2);
  await expect(widget.locator(".system-stats-widget__row-label")).toHaveText(["Load", "Docker"]);
  await expect(widget.getByRole("meter")).toHaveCount(0);
  data = { ...EMPTY_DATA, dockerError: "Socket not mounted" }; await page.reload();
  await expect(widget.locator(".widget-stat-row")).toHaveCount(1);
  await expect(widget.getByText("Docker unavailable")).toBeVisible(); await expect(widget.getByText("No stats to show")).toHaveCount(0);
});

test("System Stats initial loading, errors, null and empty states retain scoped custom CSS hooks", async ({ page, request }) => {
  await configure(request, "dark", `.system-stats-widget__hint { padding-top:7px; } .system-stats-widget--empty .system-stats-widget__hint { padding-bottom:9px; } .system-stats-widget--empty .system-stats-widget__hint--error { color:#040506; }`);
  let release!: () => void; const initial = new Promise<void>(resolve => { release = resolve; });
  let response: unknown = { ok: false, error: "Cannot read host procfs" };
  await page.route("**/api/widget*", async route => { await initial; await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) }); });
  await page.goto("/"); const widget = tile(page), loading = widget.getByRole("status", { name: "Loading widget" });
  await expect(loading).toHaveCSS("padding-top", "7px"); await expect(loading).toHaveCSS("padding-bottom", "9px");
  release(); await expect(widget.getByRole("alert")).toHaveText("Cannot read host procfs");
  await expect(widget.locator(".widget-state__label")).toHaveCSS("color", "rgb(4, 5, 6)");
  response = { ok: true, data: null }; await page.reload();
  await expect(widget.locator(".system-stats-widget--empty")).toBeVisible(); await expect(widget.getByRole("region")).toHaveCount(0); await expect(widget.getByRole("alert")).toHaveCount(0);
  response = { ok: true, data: EMPTY_DATA }; await page.reload();
  await expect(widget.getByText("No stats to show")).toHaveCSS("padding-bottom", "9px"); await expect(widget.getByRole("region")).toHaveCount(0);
});

for (const empty of [false, true]) test(`System Stats saved ${empty ? "empty" : "populated"} data retain bounds and scroll through 10-second refresh failure/recovery`, async ({ page, request }, testInfo) => {
  let fails = false;
  const data = empty ? EMPTY_DATA : { ...DATA, disk: { ...DATA.disk!, path: "/mnt/very-long-filesystem-path/host-media/production-storage-volume" }, docker: null, dockerError: "Socket unavailable" };
  await page.route("**/api/widget*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(fails ? { ok: false, error: "Host unavailable" } : { ok: true, data }) }));
  await page.clock.install();
  for (const theme of THEMES) {
    fails = false; await configure(request, theme); await page.goto("/"); const widget = tile(page, 1);
    await expect(widget.locator(empty ? ".widget-state--empty" : ".widget-stat-row")).toHaveCount(empty ? 1 : 6);
    if (!empty) await widget.getByRole("region").evaluate(node => { node.scrollTop = 30; });
    const bounds = () => widget.locator(".widget-body__content,.widget-body__notice").evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    const scrolls = () => widget.locator(".widget-body__content").evaluateAll(nodes => nodes.map(node => node.scrollTop));
    const healthy = await bounds(), offsets = await scrolls();
    fails = true; await page.clock.fastForward(10000);
    await expect(widget.getByRole("alert")).toHaveAccessibleName("Refresh failed; saved data is shown. Host unavailable");
    expect(await bounds()).toEqual(healthy); expect(await scrolls()).toEqual(offsets);
    if (empty) await expect(widget.getByRole("region")).toHaveCount(0);
    else { await expect(widget.getByText("Docker unavailable")).toHaveAttribute("title", "Socket unavailable"); await expect(widget.getByText("12%", { exact: true })).toBeVisible(); }
    if (!empty && theme === "dark") await testInfo.attach("System Stats stale", { body: await widget.screenshot({ path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/stale-dark.png` : undefined }), contentType: "image/png" });
    fails = false; await page.clock.fastForward(10000); await expect(widget.getByRole("alert")).toHaveCount(0);
    expect(await bounds()).toEqual(healthy); expect(await scrolls()).toEqual(offsets);
  }
});

test("System Stats rows, values, grouped rates, meters and scroll gap respect ordinary custom CSS", async ({ page, request }) => {
  await configure(request, "dark", `.system-stats-widget { --widget-body-content-gap:9px; } .system-stats-widget__row { --widget-stat-row-padding:4px 6px; } .system-stats-widget__row-label { color:#040506; } .system-stats-widget__row-value { color:#112233; } .system-stats-widget__row-sub { color:#223344; } .system-stats-widget__net-rates { column-gap:13px; } .system-stats-widget__net-rate { color:#334455; } .system-stats-widget__load-cell { color:#445566; } .system-stats-widget__bar { height:7px; } .system-stats-widget__bar-fill { background:#556677; }`);
  await mock(page); await page.goto("/"); const widget = tile(page, 1); await expect(widget.locator(".widget-stat-row")).toHaveCount(6);
  await expect(widget.locator(".widget-body__content")).toHaveCSS("row-gap", "9px");
  await expect(widget.locator(".system-stats-widget__row").first()).toHaveCSS("padding", "4px 6px");
  await expect(widget.locator(".system-stats-widget__row-label").first()).toHaveCSS("color", "rgb(4, 5, 6)");
  await expect(widget.locator(".system-stats-widget__row-value").first()).toHaveCSS("color", "rgb(17, 34, 51)");
  await expect(widget.locator(".system-stats-widget__row-sub").first()).toHaveCSS("color", "rgb(34, 51, 68)");
  await expect(widget.locator(".system-stats-widget__net-rates")).toHaveCSS("column-gap", "13px");
  await expect(widget.locator(".system-stats-widget__net-rate").first()).toHaveCSS("color", "rgb(51, 68, 85)");
  await expect(widget.locator(".system-stats-widget__load-cell").first()).toHaveCSS("color", "rgb(68, 85, 102)");
  await expect(widget.getByRole("meter").first()).toHaveCSS("height", "7px");
  await expect(widget.locator(".system-stats-widget__bar-fill").first()).toHaveCSS("background-color", "rgb(85, 102, 119)");
});

test("Every advertised StatRow value tone uses the shared palette for single and grouped measurements in four themes", async ({ page, request }) => {
  await mock(page);
  for (const theme of THEMES) {
    await configure(request, theme); await page.goto("/"); const widget = tile(page, 1); await expect(widget.locator(".widget-stat-row")).toHaveCount(6);
    const colors = await widget.evaluate(element => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1; const ctx = canvas.getContext("2d")!;
      const rgb = (color: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data); };
      const single = element.querySelector(".system-stats-widget__row-value")!, grouped = element.querySelector(".system-stats-widget__net-rate")!;
      const result: { target: string; tone: string; actual: number[]; expected: number[] }[] = [];
      for (const [target, node] of [["single", single], ["grouped", grouped]] as const) {
        const original = node.className;
        for (const tone of ["neutral", "positive", "info", "warning", "alert", "positive-soft", "info-soft"]) {
          node.className = `widget-stat-row__value widget-stat-row__value--tone-${tone}`;
          const style = getComputedStyle(node);
          result.push({ target, tone, actual: rgb(style.color), expected: rgb(style.getPropertyValue(`--widget-stat-tone-${tone}`).trim()) });
        }
        node.className = original;
      }
      return result;
    });
    expect(colors).toHaveLength(14);
    for (const c of colors) expect(c.actual, `${theme}: ${c.target} ${c.tone}`).toEqual(c.expected);
  }
});
