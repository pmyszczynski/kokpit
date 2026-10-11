import { test, expect, type Page, type APIRequestContext, type Locator } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";
import { expectWidgetStatLayout, expectWidgetStatContrast } from "../helpers/widget-stat";

const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const PLEX = { streams: 4, transcodes: 1, lan_streams: 3, remote_streams: 1, users: 3, bandwidth: 45000, library_movies: 1250, library_shows: 185, library_episodes: 12340, library_music: 840 };
const TAUTULLI = {
  summary: { streamCount: 4, directPlayCount: 2, directStreamCount: 1, transcodeCount: 1, totalBandwidthKbps: 45000 },
  sessions: [
    { username: "Alice", title: "The Expanse — S03 E05", state: "playing", mediaType: "episode", transcodeDecision: "transcode", progressPercent: 43 },
    { username: "Bob", title: "Dune: Part Two", state: "paused", mediaType: "movie", transcodeDecision: "direct_play", progressPercent: 66 },
    { username: "Charlie", title: "Planet Earth III", state: "buffering", mediaType: "episode", transcodeDecision: "direct_stream", progressPercent: 14 },
  ],
};
const BASE = schemaV2Fixtures([
  ...["Compact", "Wide", "Detailed", "Expanded"].map((name, i) => ({ name: `Plex · ${name}`, size: ["normal", "wide", "tall", "large"][i], widget: { type: "plex", config: { url: "http://plex.local", token: "dummy" } } })),
  ...["Default", "Expanded"].map((name, i) => ({ name: `Tautulli · ${name}`, size: i ? "large" : "tall", widget: { type: "tautulli-activity", config: { url: "http://tautulli.local", api_key: "dummy" } } })),
]);
const FIXTURES = { ...BASE, service_tiles: BASE.service_tiles.map((t, i) => ({ ...t, widget: { ...t.widget!, config: i < 4 ? { size_defaults: true } : undefined } })) };
const tile = (page: Page, index: number) => page.locator(".service-tile").filter({ has: page.getByText(FIXTURES.services[index].name, { exact: true }) });
async function configure(request: APIRequestContext, theme = "dark", indexes = [0, 1, 2, 3, 4, 5], options: { custom_css?: string; fields?: string[]; sections?: string[] } = {}) {
  expect((await request.patch("/api/settings", { data: { ...FIXTURES, groups: [], bookmarks: [], appearance: { theme, custom_css: options.custom_css },
    service_tiles: indexes.map(i => ({ ...FIXTURES.service_tiles[i], widget: { ...FIXTURES.service_tiles[i].widget, config: i < 4 ? { size_defaults: true, fields: options.fields } : { sections: options.sections } } })),
  } })).ok()).toBe(true);
}
async function mock(page: Page, plex = PLEX, tautulli: unknown = TAUTULLI, allFields = false) {
  await page.route("**/api/widget*", route => {
    const i = FIXTURES.service_tiles.findIndex(t => t.id === new URL(route.request().url()).searchParams.get("tile_id"));
    const fields = i === 0 ? ["streams", "transcodes"] : i === 1 ? ["streams", "transcodes", "bandwidth"] : i === 2 ? Object.keys(plex).slice(0, 6) : Object.keys(plex);
    const plexData = Object.fromEntries(Object.entries(plex).filter(([key]) => allFields || fields.includes(key)));
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: i < 4 ? { ...plexData, ...(i === 2 ? { sessions: TAUTULLI.sessions } : {}) } : tautulli }) });
  });
}
async function expectListFit(widget: Locator, expanded: boolean, count = 5) {
  await expect(widget.locator(".widget-stat")).toHaveCount(count);
  const measured = await widget.evaluate(element => {
    const body = element.querySelector(".widget-body")!, list = element.querySelector(".widget-list")!, header = element.querySelector(".widget-list__header")!, scroll = element.querySelector(".widget-list__scroll")!, notice = element.querySelector(".widget-body__notice")!;
    const rect = (n: Element) => n.getBoundingClientRect();
    const within = (outer: DOMRect, inner: DOMRect) => inner.left >= outer.left - .5 && inner.right <= outer.right + .5 && inner.top >= outer.top - .5 && inner.bottom <= outer.bottom + .5;
    const cards = Array.from(header.querySelectorAll(".widget-stat"));
    return { width: rect(element).width, height: rect(element).height, bodyInside: within(rect(element), rect(body)), listInside: within(rect(body), rect(list)), headerInside: within(rect(list), rect(header)), scrollInside: within(rect(list), rect(scroll)), noticeInside: within(rect(body), rect(notice)), cardsInside: cards.every(c => within(rect(header), rect(c))), horizontalOverflow: [body, header, scroll, ...cards].some(n => n.scrollWidth > n.clientWidth), scrollHeight: rect(scroll).height, columns: new Set(cards.map(c => Math.round(rect(c).left))).size };
  });
  const { scrollHeight, ...bounds } = measured;
  expect(bounds).toEqual({ width: expanded ? 688 : 340, height: 264, bodyInside: true, listInside: true, headerInside: true, scrollInside: true, noticeInside: true, cardsInside: true, horizontalOverflow: false, columns: expanded ? 5 : 3 });
  expect(scrollHeight).toBeGreaterThan(35);
}

test("Plex and Tautulli dark/light size comparison previews", async ({ page, request }, info) => {
  await page.setViewportSize({ width: 1108, height: 720 }); await mock(page);
  for (const theme of ["dark", "light"]) {
    for (const [name, indexes] of [["plex", [0, 1, 2, 3]], ["tautulli", [4, 5]]] as const) {
      await configure(request, theme, [...indexes]); await page.goto("/");
      await expect(page.locator(".widget-stat")).toHaveCount(name === "plex" ? 21 : 10);
      await expect(page.locator(".widget-list-item")).toHaveCount(name === "tautulli" ? 6 : 3);
      await info.attach(`${name} ${theme}`, { body: await page.locator(".dashboard-tile-grid").screenshot({ path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/${name}-${theme}.png` : undefined }), contentType: "image/png" });
    }
  }
});

test("Plex 2/3/6/10 cards fit with shared colors and contrast in every theme", async ({ page, request }) => {
  await page.setViewportSize({ width: 1108, height: 720 }); await mock(page);
  for (const theme of THEMES) {
    await configure(request, theme, [0, 1, 2, 3]); await page.goto("/");
    for (const [i, width, height, columns, rows, count] of [[0, 340, 128, 2, 1, 2], [1, 688, 128, 3, 1, 3], [2, 340, 264, 2, 3, 6], [3, 688, 264, 4, 3, 10]]) {
      await expect(tile(page, i).locator(".widget-stat")).toHaveCount(count);
      if (i === 2) await expectListFit(tile(page, i), false, 6);
      else await expectWidgetStatLayout(tile(page, i), { width, height, columns, rows });
      await expectWidgetStatContrast(tile(page, i));
    }
    await expect(tile(page, 3).locator('[data-field="bandwidth"] .widget-stat__value')).toHaveText("45.0 Mbps");
    await expect(tile(page, 3).locator('[data-field="library_movies"]')).toHaveClass(/tone-info/);
  }
});

test("Tautulli keeps five stats fixed while sessions scroll by keyboard in every theme", async ({ page, request }) => {
  await page.setViewportSize({ width: 1108, height: 720 }); await mock(page);
  for (const theme of THEMES) {
    await configure(request, theme, [4, 5]); await page.goto("/");
    for (const i of [4, 5]) {
      const widget = tile(page, i);
      await expect(widget.locator(".widget-stat__label")).toHaveText(["Active", "Direct Play", "Direct Stream", "Transcoding", "Bandwidth"]);
      await expectListFit(widget, i === 5); await expectWidgetStatContrast(widget);
      const list = widget.getByRole("list", { name: "Active Tautulli sessions" });
      await list.focus(); await expect(list).toBeFocused();
      const summary = await widget.locator(".widget-stat-grid").boundingBox();
      await list.press("End");
      await expect.poll(() => list.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)).toBe(true);
      await expect(widget.locator(".widget-list-item").last()).toBeInViewport();
      // When a row is taller than the scroll viewport, End reveals its footer.
      // ArrowUp must also make the last session's title reachable.
      await list.press("ArrowUp");
      await expect(widget.getByText("Planet Earth III", { exact: true })).toBeInViewport();
      expect(await widget.locator(".widget-stat-grid").boundingBox()).toEqual(summary);
      await list.press("Home"); await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(0);
      await expect(widget.getByRole("progressbar", { name: "Alice progress" })).toHaveAttribute("aria-valuenow", "43");
      await expect(widget.getByText("Playing", { exact: true })).toHaveClass(/tone-positive/);
      await expect(widget.getByText("Paused", { exact: true })).toHaveClass(/tone-neutral/);
      await expect(widget.getByText("Buffering", { exact: true })).toHaveClass(/tone-warning/);
    }
  }
});

test("Plex retains all explicitly selected fields in a keyboard-scrollable compact canvas", async ({ page, request }) => {
  await page.setViewportSize({ width: 1108, height: 720 });
  await mock(page, { ...PLEX, library_movies: 123456789012, bandwidth: 1234567890 }, TAUTULLI, true);
  await configure(request, "dark", [0], { fields: Object.keys(PLEX) }); await page.goto("/");
  const widget = tile(page, 0), scroll = widget.getByRole("region", { name: "Plex measurements" });
  await expect(widget.locator(".widget-stat")).toHaveCount(10);
  await expect(widget.locator('[data-field="bandwidth"] .widget-stat__value')).toHaveText("1.2 Tbps");
  await scroll.focus(); await scroll.press("End");
  await expect(widget.locator('[data-field="library_music"]')).toBeInViewport();
  expect(await scroll.evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
});

test("Tautulli retains full long metadata and clamps playback progress without horizontal overflow", async ({ page, request }) => {
  const username = "Very long username ".repeat(15), title = "A very long episode title ".repeat(20);
  await mock(page, PLEX, { ...TAUTULLI, sessions: [{ ...TAUTULLI.sessions[0], username, title, progressPercent: 120, state: "unknown" }, { ...TAUTULLI.sessions[1], progressPercent: -5 }] });
  await configure(request, "dark", [4, 5]); await page.goto("/");
  for (const i of [4, 5]) {
    const widget = tile(page, i); await expectListFit(widget, i === 5);
    await expect(widget.locator(".widget-list-item__title").first()).toHaveAttribute("title", title);
    await expect(widget.locator(".widget-list-item__secondary").first()).toHaveAttribute("title", `${username} · Episode · Transcode`);
    await expect(widget.getByRole("progressbar").first()).toHaveAttribute("aria-valuenow", "100");
    await expect(widget.getByRole("progressbar").last()).toHaveAttribute("aria-valuenow", "0");
    await expect(widget.getByText("Unknown", { exact: true })).toHaveClass(/tone-neutral/);
  }
});

test("Tautulli supports summary-only, sessions-only and saved empty sessions without an empty scroll target", async ({ page, request }) => {
  let data: unknown = { summary: TAUTULLI.summary };
  await page.route("**/api/widget*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) }));
  await configure(request, "dark", [4], { sections: ["summary"] }); await page.goto("/");
  await expect(tile(page, 4).locator(".widget-stat")).toHaveCount(5); await expect(tile(page, 4).getByRole("list")).toHaveCount(0);
  data = { sessions: TAUTULLI.sessions };
  await configure(request, "dark", [4], { sections: ["sessions"] }); await page.reload();
  await expect(tile(page, 4).locator(".widget-stat")).toHaveCount(0); await expect(tile(page, 4).getByRole("list")).toHaveAttribute("tabindex", "0");
  data = { summary: TAUTULLI.summary, sessions: [] }; await page.reload();
  await expect(tile(page, 4).getByText("No active streams")).toBeVisible(); await expect(tile(page, 4).getByRole("list")).toHaveCount(0);
});

test("zero values use shared neutral/info colors and empty/null feedback remains scoped", async ({ page, request }) => {
  let empty = false, missing = false;
  await page.route("**/api/widget*", route => {
    const plex = new URL(route.request().url()).searchParams.get("tile_id") === FIXTURES.service_tiles[1].id;
    const data = missing ? null : plex ? empty ? {} : { streams: 0, transcodes: 0, bandwidth: 0 } : { summary: { streamCount: 0, directPlayCount: 0, directStreamCount: 0, transcodeCount: 0, totalBandwidthKbps: 0 }, sessions: [] };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  });
  for (const theme of THEMES) {
    await configure(request, theme, [1, 5]); await page.goto("/");
    await expect(tile(page, 1).locator(".widget-stat--tone-neutral")).toHaveCount(2);
    await expect(tile(page, 5).locator(".widget-stat--tone-neutral")).toHaveCount(4);
    await expect(tile(page, 5).getByText("No active streams")).toBeVisible();
    await expect(tile(page, 5).getByRole("list")).toHaveCount(0);
    for (const tone of ["neutral", "info"]) {
      const color = (el: Element) => getComputedStyle(el).color;
      expect(await tile(page, 1).locator(`.widget-stat--tone-${tone} .widget-stat__value`).first().evaluate(color)).toEqual(await tile(page, 5).locator(`.widget-stat--tone-${tone} .widget-stat__value`).first().evaluate(color));
    }
  }
  empty = true; await page.reload(); await expect(tile(page, 1).getByText("No measurements")).toBeVisible();
  missing = true; await page.reload();
  for (const i of [1, 5]) { await expect(tile(page, i).locator(".widget-body--centered")).toBeVisible(); await expect(tile(page, i).getByRole("alert")).toHaveCount(0); }
});

test("Plex and Tautulli preserve scoped loading/error hooks and recover saved data after stale refreshes", async ({ page, request }) => {
  await page.clock.install(); await page.clock.pauseAt(new Date()); await configure(request, "dark", [2, 5]);
  let mode = "loading", release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/widget*", async route => {
    if (mode === "loading") await blocked;
    const plex = new URL(route.request().url()).searchParams.get("tile_id") === FIXTURES.service_tiles[2].id;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(mode === "error" ? { ok: false, error: "Service unavailable" } : { ok: true, data: plex ? { ...Object.fromEntries(Object.entries(PLEX).slice(0, 6)), sessions: TAUTULLI.sessions } : TAUTULLI }) });
  });
  await page.goto("/");
  for (const i of [2, 5]) await expect(tile(page, i).getByRole("status", { name: "Loading widget" })).toBeVisible();
  mode = "error"; release();
  for (const i of [2, 5]) await expect(tile(page, i).getByRole("alert")).toHaveText("Service unavailable");
  mode = "success"; await page.clock.runFor(10001);
  await expect(tile(page, 2).locator(".widget-stat")).toHaveCount(6); await expect(tile(page, 5).locator(".widget-stat")).toHaveCount(5);
  const before = await tile(page, 5).locator(".widget-stat-grid").boundingBox();
  mode = "error"; await page.clock.runFor(10001);
  for (const i of [2, 5]) await expect(tile(page, i).getByRole("alert")).toContainText("Refresh failed");
  expect(await tile(page, 5).locator(".widget-stat-grid").boundingBox()).toEqual(before);
  await expect(tile(page, 5).locator(".widget-list-item")).toHaveCount(3);
  mode = "success"; await page.clock.runFor(10001);
  for (const i of [2, 5]) await expect(tile(page, i).getByRole("alert")).toHaveCount(0);
});

test("ordinary custom CSS overrides shared Plex cards and Tautulli rows, badges and bars", async ({ page, request }) => {
  await mock(page); await configure(request, "dark", [0, 5], { custom_css: ".plex-widget__value { color:#010203; } .tautulli-activity-widget__session { padding:9px; } .widget-list-item__footer { padding-top:2px; } .tautulli-activity-widget__session-heading { color:#040506; } .tautulli-activity-widget__progress { height:7px; } .widget-bar__fill { background:#070809; }" }); await page.goto("/");
  await expect(tile(page, 0).locator(".widget-stat__value").first()).toHaveCSS("color", "rgb(1, 2, 3)");
  await expect(tile(page, 5).locator(".widget-list-item").first()).toHaveCSS("padding", "9px");
  await expect(tile(page, 5).locator(".widget-list-item__footer").first()).toHaveCSS("padding-top", "2px");
  await expect(tile(page, 5).locator(".widget-badge").first()).toHaveCSS("color", "rgb(4, 5, 6)");
  await expect(tile(page, 5).getByRole("progressbar").first()).toHaveCSS("height", "7px");
  await expect(tile(page, 5).locator(".widget-bar__fill").first()).toHaveCSS("background-color", "rgb(7, 8, 9)");
});

test("Plex Detailed uses the same playback rows as Tautulli with fixed stats and keyboard scrolling", async ({ page, request }, info) => {
  await page.setViewportSize({ width: 1108, height: 720 }); await mock(page);
  for (const theme of THEMES) {
    await configure(request, theme, [2, 4]); await page.goto("/");
    const plex = tile(page, 2), tautulli = tile(page, 4);
    await expectListFit(plex, false, 6); await expectWidgetStatContrast(plex);
    const style = (el: Element) => { const s = getComputedStyle(el); return { padding: s.padding, gap: s.gap, border: s.borderBottom, height: el.getBoundingClientRect().height }; };
    expect(await plex.locator(".widget-list-item").first().evaluate(style)).toEqual(await tautulli.locator(".widget-list-item").first().evaluate(style));
    const list = plex.getByRole("list", { name: "Active Plex sessions" }), summary = await plex.locator(".widget-stat-grid").boundingBox();
    await list.focus(); await list.press("End");
    await expect.poll(() => list.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)).toBe(true);
    await expect(plex.getByText("Planet Earth III", { exact: true })).toBeInViewport();
    expect(await plex.locator(".widget-stat-grid").boundingBox()).toEqual(summary);
    await list.press("Home"); await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(0);
    await expect(plex.getByRole("progressbar", { name: "Alice progress" })).toHaveAttribute("aria-valuenow", "43");
    await expect(plex.getByText("Playing", { exact: true })).toHaveClass(/tone-positive/);
    await expect(plex.getByText("Paused", { exact: true })).toHaveClass(/tone-neutral/);
    await list.evaluate(el => (el as HTMLElement).blur());
    if (theme === "dark" || theme === "light") await info.attach(`Playback lists ${theme}`, { body: await page.locator(".dashboard-tile-grid").screenshot({ path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/playback-${theme}.png` : undefined }), contentType: "image/png" });
  }
});

test("Plex Detailed preserves long/unknown metadata, empty playback and all ten custom fields", async ({ page, request }) => {
  await page.setViewportSize({ width: 1108, height: 720 });
  const title = "Long episode title ".repeat(30), username = "Long user ".repeat(20);
  let data: unknown = { ...Object.fromEntries(Object.entries(PLEX).slice(0, 6)), sessions: [{ ...TAUTULLI.sessions[0], title, username, state: "unknown", progressPercent: null }] };
  await page.route("**/api/widget*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) }));
  await configure(request, "dark", [2]); await page.goto("/"); const widget = tile(page, 2);
  await expectListFit(widget, false, 6);
  await expect(widget.locator(".widget-list-item__title")).toHaveAttribute("title", title);
  await expect(widget.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  await expect(widget.getByText("Unknown progress")).toBeVisible();
  await expect(widget.getByText("Unknown", { exact: true })).toHaveClass(/tone-neutral/);
  data = { ...Object.fromEntries(Object.entries(PLEX).slice(0, 6)), sessions: [] }; await page.reload();
  await expect(widget.getByText("No active streams")).toBeVisible(); await expect(widget.getByRole("list")).toHaveCount(0);
  data = { ...PLEX, sessions: TAUTULLI.sessions };
  await configure(request, "dark", [2], { fields: Object.keys(PLEX) }); await page.reload();
  await expect(widget.locator(".widget-stat")).toHaveCount(10);
  const scroll = widget.getByRole("list", { name: "Active Plex sessions" });
  await scroll.focus(); await scroll.press("End"); await expect(widget.getByText("Planet Earth III", { exact: true })).toBeInViewport();
  expect(await scroll.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await scroll.press("Home"); await expect(widget.getByText("Streaming", { exact: true })).toBeInViewport();
  data = { ...PLEX, sessions: [] }; await page.reload();
  await expect(widget.locator(".widget-stat")).toHaveCount(10);
  await widget.getByRole("list", { name: "Active Plex sessions" }).focus();
  await page.keyboard.press("End"); await expect(widget.getByText("No active streams")).toBeInViewport();
});
