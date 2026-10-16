import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import type { RssData } from "../../src/integrations/rss/api";

const FOOTPRINTS = [{ columnSpan: 3, rowSpan: 3 }, { columnSpan: 6, rowSpan: 3 }, { columnSpan: 6, rowSpan: 4 }];
const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const HEADLINES = ["A quieter homelab: small changes that make a difference", "Kokpit: a new view for your daily reading", "The backup you tested is the backup you can trust", "What’s new in the self-hosted community this week", "Building a dashboard that feels like home", "Your weekend project: monitor the things that matter", "Seven useful services for a small home server", "A very long headline with every important word available through the article’s accessible link and full-title tooltip"];
const DATA: RssData = { title: "Homelab Journal", articles: HEADLINES.map((title, i) => ({ title, url: `https://example.com/articles/${i + 1}`, publishedAt: `2026-10-${16 - i}T10:00:00.000Z`, summary: ["Lower power use, less noise, and a few practical upgrades for the server under your desk.", "Headlines and article links, right alongside the rest of your services.", "A simple restore drill can turn a hopeful backup strategy into a reliable one."][i % 3] })) };
function fixtures(footprints = [FOOTPRINTS[0]]) {
  return { services: footprints.map((_, i) => ({ id: `10000000-0000-4000-8000-00000000000${i}`, name: `Reading · ${["Compact", "Wide", "Detailed"][i]}`, description: "RSS / Atom", icon: "mdi-rss", launch_url: "https://example.com/" })),
    service_tiles: footprints.map((footprint, i) => ({ id: `20000000-0000-4000-8000-00000000000${i}`, service_id: `10000000-0000-4000-8000-00000000000${i}`, footprint, widget: { type: "rss", config: { feed_url: "https://example.com/feed.xml", max_items: 8 } } })) };
}
async function configure(request: APIRequestContext, footprints = [FOOTPRINTS[0]], theme: typeof THEMES[number] = "dark", custom_css?: string) {
  expect((await request.patch("/api/settings", { data: { ...fixtures(footprints), groups: [], bookmarks: [], appearance: { theme, custom_css } } })).ok()).toBe(true);
}
const tile = (page: Page) => page.locator('.service-tile').filter({ has: page.locator('[data-widget-type="rss"]') });
async function mock(page: Page, data: RssData | null = DATA) {
  await page.route("**/api/widget?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) }));
  await page.route("**/api/ping", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, status: 200 }) }));
  await page.route("**/rss.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#f59e0b" d="M6.18 15.64a2.18 2.18 0 0 0-2.18 2.18A2.18 2.18 0 0 0 6.18 20a2.18 2.18 0 0 0 2.18-2.18 2.18 2.18 0 0 0-2.18-2.18M4 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83C19.56 11.41 12.59 4.44 4 4.44m0 5.66v2.83A7.07 7.07 0 0 1 11.07 20h2.83c0-5.47-4.43-9.9-9.9-9.9Z"/></svg>' }));
}
test.use({ locale: "en-US", timezoneId: "Pacific/Kiritimati" });

test("RSS lists fit three distinct sizes in all themes with real Home/End scrolling", async ({ page, request }) => {
  await mock(page);
  for (const footprint of FOOTPRINTS) for (const theme of THEMES) {
    await configure(request, [footprint], theme); await page.goto("/");
    const widget = tile(page); const list = widget.getByRole("list", { name: "Feed articles" });
    await expect(list.getByRole("listitem")).toHaveCount(8);
    await expect(widget.getByRole("link", { name: HEADLINES[7], exact: true })).toHaveAttribute("href", "https://example.com/articles/8");
    expect(await list.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const summary = await widget.locator(".widget-list__summary").boundingBox();
    const notice = await widget.locator(".widget-body__notice").boundingBox();
    await list.focus(); await list.press("End");
    await expect.poll(() => list.evaluate(element => element.scrollTop > 0 && Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) < 2)).toBe(true);
    expect(await list.evaluate(element => {
      const last = element.lastElementChild!.getBoundingClientRect(); const bounds = element.getBoundingClientRect();
      return last.bottom <= bounds.bottom + 1 && last.top >= bounds.top - 1;
    })).toBe(true);
    await list.press("Home"); await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(0);
    expect(await widget.locator(".widget-list__summary").boundingBox()).toEqual(summary);
    expect(await widget.locator(".widget-body__notice").boundingBox()).toEqual(notice);
    expect(await widget.evaluate(element => {
      const tile = element.getBoundingClientRect(); const list = element.querySelector(".widget-list")!.getBoundingClientRect(); const notice = element.querySelector(".widget-body__notice")!.getBoundingClientRect();
      return list.top >= tile.top && list.bottom <= notice.top + 1 && notice.bottom <= tile.bottom;
    })).toBe(true);
    const ratios = await widget.locator(".widget-list-item__title, .widget-list-item__secondary").evaluateAll(elements => {
      function luminance(color: string) {
        return color.match(/\d+(?:\.\d+)?/g)!.slice(0, 3).map(Number).map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      }
      return elements.map(element => {
        let parent: Element | null = element; let bg = "rgba(0, 0, 0, 0)";
        while (parent && bg === "rgba(0, 0, 0, 0)") { bg = getComputedStyle(parent).backgroundColor; parent = parent.parentElement; }
        const values = [luminance(getComputedStyle(element).color), luminance(bg)].sort((a, b) => b - a); return (values[0] + .05) / (values[1] + .05);
      });
    });
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
  }
});

test("RSS Detailed adds complete summaries while every size retains all configured articles", async ({ page, request }) => {
  await mock(page); await configure(request, FOOTPRINTS); await page.goto("/");
  await expect(page.locator(".widget-list-item")).toHaveCount(24);
  await expect(tile(page).nth(0).getByText(DATA.articles[0].summary, { exact: false })).toHaveCount(0);
  await expect(tile(page).nth(2).getByText(DATA.articles[0].summary, { exact: false }).first()).toBeVisible();
  await expect(tile(page).nth(2).locator("time").first()).toHaveText("Oct 16, 2026");
});

test("RSS long feed names retain a single-line summary and usable Compact scrolling", async ({ page, request }) => {
  const title = "A very long feed name with important context ".repeat(5).slice(0, 200);
  await configure(request); await mock(page, { ...DATA, title }); await page.goto("/");
  await expect(tile(page).getByTitle(title)).toBeVisible();
  const summary = tile(page).locator(".rss-widget__feed-title");
  expect(await summary.evaluate(element => element.clientHeight <= 20 && element.scrollWidth > element.clientWidth)).toBe(true);
  const list = tile(page).getByRole("list", { name: "Feed articles" });
  expect((await list.boundingBox())!.height).toBeGreaterThan(70);
  await list.focus(); await list.press("End");
  await expect.poll(() => list.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) < 1)).toBe(true);
});

test("RSS article links and service header navigate independently without nested anchors", async ({ page, request, context }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await configure(request); await mock(page);
  await context.route("https://example.com/articles/1", route => route.fulfill({ body: "Article destination" }));
  await page.goto("/");
  await expect(tile(page).getByRole("link", { name: "Reading · Compact", exact: true })).toHaveAttribute("href", "https://example.com/");
  const article = tile(page).getByRole("link", { name: HEADLINES[0], exact: true });
  expect(await article.evaluate(element => element.parentElement!.closest("a") === null)).toBe(true);
  const opened = page.waitForEvent("popup"); await article.click(); const popup = await opened; await expect(popup).toHaveURL("https://example.com/articles/1"); await popup.close();
  expect(errors).toEqual([]);
});

test("RSS stale refresh keeps articles, scroll position and geometry, then recovers", async ({ page, request }) => {
  let fails = false;
  await page.route("**/api/widget?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(fails ? { ok: false, error: "Feed unavailable" } : { ok: true, data: DATA }) }));
  await page.clock.install({ time: new Date("2026-10-16T12:00:00Z") }); await configure(request, [FOOTPRINTS[2]]); await page.goto("/");
  const list = tile(page).getByRole("list", { name: "Feed articles" }); await expect(list.getByRole("listitem")).toHaveCount(8);
  await list.focus(); await list.press("End"); await expect.poll(() => list.evaluate(element => element.scrollTop > 0 && Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) < 1)).toBe(true);
  const bounds = await list.boundingBox(); const scroll = await list.evaluate(element => element.scrollTop);
  fails = true; await page.clock.fastForward(600_000);
  await expect(tile(page).getByRole("alert")).toHaveAccessibleName("Refresh failed; saved data is shown. Feed unavailable");
  expect(await list.boundingBox()).toEqual(bounds); expect(await list.evaluate(element => element.scrollTop)).toBe(scroll);
  fails = false; await page.clock.fastForward(600_000); await expect(tile(page).getByRole("alert")).toHaveCount(0);
  expect(await list.boundingBox()).toEqual(bounds);
});

test("RSS refresh preserves the focused article when new entries are prepended", async ({ page, request }) => {
  let data = DATA;
  await page.route("**/api/widget?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) }));
  await page.clock.install({ time: new Date("2026-10-16T12:00:00Z") }); await configure(request); await page.goto("/");
  const article = tile(page).getByRole("link", { name: HEADLINES[0], exact: true }); await article.focus();
  data = { ...DATA, articles: [{ ...DATA.articles[0], title: "A new headline", url: "https://example.com/new" }, ...DATA.articles] };
  await page.clock.fastForward(600_000);
  await expect(tile(page).getByRole("listitem")).toHaveCount(9);
  await expect(article).toBeFocused(); await expect(article).toHaveAttribute("href", DATA.articles[0].url!);
});

for (const nativeId of [true, false]) test(`RSS same-URL prepends preserve focused headline, native ID: ${nativeId}`, async ({ page, request }) => {
  const original = { ...DATA.articles[0], ...(nativeId ? { id: "article-original" } : {}) };
  let data: RssData = { ...DATA, articles: [original] };
  await page.route("**/api/widget?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) }));
  await page.clock.install({ time: new Date("2026-10-16T12:00:00Z") }); await configure(request); await page.goto("/");
  const article = tile(page).getByRole("link", { name: original.title, exact: true }); await article.focus();
  data = { ...DATA, articles: [{ ...original, title: "A different article sharing the URL", ...(nativeId ? { id: "article-new" } : {}) }, original] };
  await page.clock.fastForward(600_000); await expect(tile(page).getByRole("listitem")).toHaveCount(2);
  await expect(article).toBeFocused(); await expect(article).toHaveText(original.title);
});

test("RSS uses shared loading/error/empty feedback and explicit missing fields", async ({ page, request }) => {
  await configure(request); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let response: unknown = { ok: false, error: "Feed unavailable" };
  await page.route("**/api/widget?*", async route => { await gate; await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) }); });
  await page.goto("/"); await expect(tile(page).getByRole("status", { name: "Loading widget" })).toBeVisible(); release();
  await expect(tile(page).getByRole("alert")).toHaveText("Feed unavailable");
  response = { ok: true, data: { title: "Empty", articles: [] } }; await page.reload(); await expect(tile(page).getByText("No articles in this feed")).toBeVisible();
  response = { ok: true, data: { title: "Partial", articles: [{ title: "Untitled article", url: null, publishedAt: null, summary: "" }] } };
  await page.reload(); await expect(tile(page).getByText("Date unavailable")).toBeVisible(); await expect(tile(page).getByRole("listitem").getByRole("link")).toHaveCount(0);
});

test("RSS preset persists feed URL and article limit without a service integration", async ({ page, request }) => {
  expect((await request.patch("/api/settings", { data: { services: [], service_tiles: [], groups: [{ name: "Reading" }], bookmarks: [], appearance: { theme: "dark" } } })).ok()).toBe(true);
  await mock(page); await page.goto("/"); await page.getByRole("button", { name: "Edit dashboard" }).click();
  await page.getByRole("button", { name: "Add tile to Reading" }).click(); await page.getByRole("dialog").getByRole("button", { name: "RSS / Atom", exact: true }).click();
  await expect(page.getByLabel("Footprint", { exact: true })).toHaveValue("3x3");
  await page.getByLabel("Feed URL *", { exact: true }).fill("https://example.com/feed.xml"); await page.getByLabel("Article limit", { exact: true }).fill("8");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const saved = page.waitForResponse(r => r.url().endsWith("/api/settings") && r.request().method() === "PATCH"); await page.getByRole("button", { name: /Save & exit/ }).click(); expect((await saved).ok()).toBe(true);
  await expect(page.locator(".edit-bar")).toBeHidden();
  const persisted = await (await request.get("/api/settings")).json();
  expect(persisted.service_tiles[0]).toMatchObject({ footprint: FOOTPRINTS[0], widget: { type: "rss", config: { feed_url: "https://example.com/feed.xml", max_items: 8 } } });
  expect(persisted.services[0].integration).toBeUndefined(); await page.reload(); await expect(tile(page).getByRole("listitem")).toHaveCount(8);
});

test("RSS server fetch blocks a private destination with bounded public diagnostics", async ({ request }) => {
  const data = fixtures();
  data.service_tiles[0].widget.config.feed_url = "http://127.0.0.1:9/private-feed";
  expect((await request.patch("/api/settings", { data: { ...data, groups: [], bookmarks: [] } })).ok()).toBe(true);
  const response = await request.get(`/api/widget?tile_id=${data.service_tiles[0].id}&widget_type=rss`);
  expect(response.status()).toBe(502);
  const body = await response.json();
  expect(body).toMatchObject({ ok: false, code: "widget_upstream_unreachable", error: "The integration could not be reached." });
  expect(body.incidentId).toMatch(/^wgt_/);
  expect(JSON.stringify(body)).not.toMatch(/127\.0\.0\.1|private-feed|Blocked outbound/);
});

test("ordinary custom CSS overrides RSS rows and link styling", async ({ page, request }) => {
  await mock(page); await configure(request, [FOOTPRINTS[2]], "dark", ".rss-widget__article { background: #010203; border-color: #123456; } .rss-widget__link { color: #abcdef; } .rss-widget { --widget-list-item-padding: 10px 6px; }"); await page.goto("/");
  await expect(tile(page).getByRole("listitem").first()).toHaveCSS("background-color", "rgb(1, 2, 3)");
  await expect(tile(page).getByRole("listitem").first()).toHaveCSS("padding-top", "10px");
  await expect(tile(page).getByRole("listitem").first().getByRole("link")).toHaveCSS("color", "rgb(171, 205, 239)");
});

test("RSS dark/light previews show Compact, Wide and Detailed", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1108, height: 780 }); await mock(page);
  for (const theme of ["dark", "light"] as const) {
    await configure(request, FOOTPRINTS, theme); await page.goto("/"); await expect(page.locator(".widget-list-item")).toHaveCount(24);
    await testInfo.attach(`RSS-${theme}`, { body: await page.locator(".dashboard-tile-grid").screenshot({ path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/rss-${theme}.png` : undefined }), contentType: "image/png" });
  }
});
