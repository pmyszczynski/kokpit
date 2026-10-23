import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { withSettledConfigurationCheck } from "../helpers/configuration-check";
/** Locate Search independently of its configurable service and engine names. */
const tile = (page: Page) => page.locator('.service-tile').filter({ has: page.locator('[data-widget-type="search"]') });
const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const FOOTPRINTS = [{ columnSpan: 6, rowSpan: 2 }, { columnSpan: 3, rowSpan: 2 }] as const;
/** Persist a canonical Search tile through the public settings API for browser checks. */
async function configure(request: APIRequestContext, config: Record<string, unknown> = {}, theme: typeof THEMES[number] = "dark", custom_css = "", launch_url?: string, footprint: typeof FOOTPRINTS[number] = FOOTPRINTS[0]) {
  const response = await request.patch("/api/settings", { data: { services: [{ id: "10000000-0000-4000-8000-000000000001", name: "Search", description: "Find something useful", icon: "/icons/search.svg", ...(launch_url ? { launch_url } : {}) }],
    service_tiles: [{ id: "20000000-0000-4000-8000-000000000001", service_id: "10000000-0000-4000-8000-000000000001", footprint, widget: { type: "search", config } }], groups: [], bookmarks: [], appearance: { theme, custom_css } } });
  expect(response.ok()).toBe(true);
}

for (const footprint of FOOTPRINTS) test(`Search ${footprint.columnSpan}x2 uses native encoded GET submission with fixed parameters and an isolated new tab`, async ({ page, context, request }) => {
  await configure(request, { search_url: "https://search.example/profile/search?language=pl&category=it&category=science&query=obsolete&query=older", query_parameter: "query", engine_name: "Home search" }, "dark", "", undefined, footprint);
  let engineRequests = 0; const localRequests: string[] = [];
  page.on("request", request => { if (request.url().startsWith("http://localhost")) localRequests.push(request.url()); });
  await context.route("https://search.example/**", route => { engineRequests++; return route.fulfill({ contentType: "text/html", body: "Search results" }); });
  await page.goto("/"); await expect(tile(page).getByRole("searchbox")).toBeVisible(); expect(engineRequests).toBe(0);
  const query = "café & C++ #home / 你好?";
  await tile(page).getByRole("searchbox").fill(`  ${query}  `);
  const opened = page.waitForEvent("popup"); await tile(page).getByRole("searchbox").press("Enter"); const popup = await opened;
  await expect(popup).toHaveURL(/search\.example\/profile\/search\?/);
  const destination = new URL(popup.url()); expect(destination.searchParams.getAll("query")).toEqual([query]);
  expect(destination.searchParams.get("language")).toBe("pl"); expect(destination.searchParams.getAll("category")).toEqual(["it", "science"]);
  expect(destination.hash).toBe(""); expect(await popup.evaluate(() => window.opener)).toBeNull(); expect(await popup.evaluate(() => document.referrer)).toBe("");
  expect(localRequests.some(url => url.includes("caf") || url.includes("C%2B"))).toBe(false);
  await popup.close(); expect(engineRequests).toBe(1);
});

for (const queryParameter of ["search[query]", "querySelector"]) test(`Search supports same-tab results with parameter ${queryParameter}`, async ({ page, request }) => {
  await configure(request, { search_url: "https://search.example/search?language=en&querySelectorAll=fixed", query_parameter: queryParameter, new_tab: false });
  await page.route("https://search.example/**", route => route.fulfill({ contentType: "text/html", body: "Results" }));
  await page.goto("/"); await tile(page).getByRole("searchbox").fill("home network"); await tile(page).getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/search\.example\/search\?/); expect(new URL(page.url()).searchParams.get(queryParameter)).toBe("home network");
});

test("Search blocks blank queries and performs no background polling or engine requests", async ({ page, context, request }) => {
  await configure(request, { search_url: "https://search.example/search" });
  let widgetRequests = 0; let engineRequests = 0;
  page.on("request", request => { if (request.url().includes("/api/widget?")) widgetRequests++; });
  await context.route("https://search.example/**", route => { engineRequests++; return route.abort(); });
  await page.clock.install(); await withSettledConfigurationCheck(page, () => page.goto("/")); await expect(tile(page).getByRole("searchbox")).toBeVisible();
  await tile(page).getByRole("searchbox").fill("   "); await tile(page).getByRole("button", { name: "Search", exact: true }).click();
  expect(await tile(page).getByRole("searchbox").evaluate((input: HTMLInputElement) => input.validationMessage)).toBe("Enter a search query.");
  await tile(page).getByRole("searchbox").fill("ready"); expect(await tile(page).getByRole("searchbox").evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(true);
  const initialRequests = widgetRequests; expect(initialRequests).toBeGreaterThan(0);
  await withSettledConfigurationCheck(page, () => page.clock.fastForward(600_000)); expect(widgetRequests).toBe(initialRequests); expect(engineRequests).toBe(0);
});

for (const footprint of FOOTPRINTS) test(`Search fits its ${footprint.columnSpan}x2 tile with visible controls, keyboard focus and contrast in four themes`, async ({ page, request }) => {
  for (const theme of THEMES) {
    await configure(request, {}, theme, "", undefined, footprint); await page.goto("/"); const widget = tile(page);
    await expect(widget.getByRole("searchbox", { name: "Search query" })).toBeVisible(); await expect(widget.getByRole("button", { name: "Search", exact: true })).toBeVisible();
    await expect(widget.getByText("DuckDuckGo · Opens in a new tab", { exact: true })).toBeVisible();
    const geometry = await widget.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const form = element.querySelector(".widget-search-form")!.getBoundingClientRect(); const input = element.querySelector(".widget-search-form__input")!.getBoundingClientRect();
      const caption = element.querySelector(".search-widget__destination")!;
      return { width: bounds.width, height: bounds.height, alignedInput: input.left === form.left, completeCaption: caption.scrollHeight <= caption.clientHeight, fit: [...element.querySelectorAll(".widget-search-form, .widget-search-form__input, .widget-search-form__button, .search-widget__destination, .widget-body__notice")].every(node => {
        const rect = node.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
      }) };
    });
    expect(geometry).toEqual({ width: footprint.columnSpan === 3 ? 340 : 688, height: 128, alignedInput: true, completeCaption: true, fit: true });
    const ratios = await widget.locator(".widget-search-form__input, .widget-search-form__button, .search-widget__destination").evaluateAll(elements => {
      /** Compute WCAG relative luminance from serialized RGB or CSS Color 4 sRGB. */
      function luminance(color: string) { const values = color.match(/\d+(?:\.\d+)?/g)!.slice(0, 3).map(Number); return values.map(v => { const c = color.startsWith("color(srgb ") ? v : v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0); }
      return elements.map(element => { let parent: Element | null = element; let background = "rgba(0, 0, 0, 0)"; while (parent && background === "rgba(0, 0, 0, 0)") { background = getComputedStyle(parent).backgroundColor; parent = parent.parentElement; } const values = [luminance(getComputedStyle(element).color), luminance(background)].sort((a, b) => b - a); return (values[0] + .05) / (values[1] + .05); });
    });
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
    await widget.getByRole("searchbox").focus(); await page.keyboard.press("Tab"); await expect(widget.getByRole("button", { name: "Search", exact: true })).toBeFocused();
  }
});

for (const footprint of FOOTPRINTS) test(`Search preset saves ${footprint.columnSpan}x2 and immediately applies engine options without a service connection`, async ({ page, request }) => {
  expect((await request.patch("/api/settings", { data: { services: [], service_tiles: [], groups: [{ name: "Tools" }], bookmarks: [] } })).ok()).toBe(true);
  await page.goto("/"); await page.getByRole("button", { name: "Edit dashboard" }).click(); await page.getByRole("button", { name: "Add tile to Tools" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByLabel("Footprint", { exact: true })).toHaveValue("6x2");
  await expect(page.getByLabel("Footprint", { exact: true }).locator("option")).toHaveText(["Wide (6×2)", "Compact (3×2)"]);
  await page.getByLabel("Footprint", { exact: true }).selectOption(`${footprint.columnSpan}x2`);
  await expect(page.getByRole("button", { name: "Test connection", exact: true })).toHaveCount(0);
  await page.getByLabel("Search URL", { exact: true }).fill("https://search.example/search?language=pl"); await page.getByLabel("Query parameter", { exact: true }).fill("query");
  await page.getByLabel("Engine name", { exact: true }).fill("SearXNG"); await page.getByLabel("Open results in a new tab", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Save", exact: true }).click(); const saved = page.waitForResponse(response => response.url().endsWith("/api/settings") && response.request().method() === "PATCH");
  await page.getByRole("button", { name: /Save & exit/ }).click(); expect((await saved).ok()).toBe(true);
  await expect(tile(page).getByRole("search", { name: "Search with SearXNG" })).toHaveAttribute("action", "https://search.example/search");
  const persisted = await (await request.get("/api/settings")).json(); expect(persisted.services[0].integration).toBeUndefined();
  expect(persisted.service_tiles[0]).toMatchObject({ footprint, widget: { type: "search", config: { search_url: "https://search.example/search?language=pl", query_parameter: "query", engine_name: "SearXNG", new_tab: false } } });
  await page.reload(); await expect(tile(page).getByRole("search")).toHaveAttribute("target", "_self");
});

for (const footprint of FOOTPRINTS) test(`Search ${footprint.columnSpan}x2 retains query, focus and control geometry through a failed options refresh`, async ({ page, request }) => {
  await configure(request, {}, "dark", "", undefined, footprint);
  const settings = await (await request.get("/api/settings")).json(); settings.service_tiles[0].widget.refresh_interval_ms = 5000;
  const saved = await request.patch("/api/settings", { data: { service_tiles: settings.service_tiles } });
  expect(saved.ok(), await saved.text()).toBe(true);
  const response = await (await request.get("/api/widget?tile_id=20000000-0000-4000-8000-000000000001&widget_type=search")).json();
  let fail = false;
  await page.route("**/api/widget?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(fail ? { ok: false, error: "Options unavailable" } : response) }));
  await page.clock.install(); await withSettledConfigurationCheck(page, () => page.goto("/")); const input = tile(page).getByRole("searchbox");
  await input.fill("keep my search"); await input.focus(); const bounds = await input.boundingBox();
  fail = true; await withSettledConfigurationCheck(page, () => page.clock.fastForward(5000)); await expect(tile(page).getByRole("alert")).toHaveAttribute("title", "Options unavailable");
  await expect(input).toHaveValue("keep my search"); await expect(input).toBeFocused(); expect(await input.boundingBox()).toEqual(bounds);
  fail = false; await withSettledConfigurationCheck(page, () => page.clock.fastForward(300_001)); await expect(tile(page).getByRole("alert")).toHaveCount(0); expect(await input.boundingBox()).toEqual(bounds);
});

test("Search controls remain independent of a linked service header", async ({ page, request }) => {
  await configure(request, {}, "dark", "", "https://example.com/"); await page.goto("/");
  await expect(tile(page).getByRole("link", { name: "Search", exact: true })).toHaveAttribute("href", "https://example.com/");
  expect(await tile(page).evaluate(element => element.tagName)).toBe("DIV");
  expect(await tile(page).getByRole("search").evaluate(form => form.closest("a") === null)).toBe(true);
});

test("Search supports ordinary custom CSS and retains the full long engine name", async ({ page, request }) => {
  const engine_name = "My self-hosted search engine with a deliberately long but meaningful label";
  await configure(request, { engine_name }, "dark", ".widget-search-form__button { background: rgb(1, 2, 3); font-size: 16px; } .widget-search-form__input { border-color: rgb(18, 52, 86); }", undefined, FOOTPRINTS[1]); await page.goto("/");
  await expect(tile(page).getByRole("button", { name: "Search", exact: true })).toHaveCSS("background-color", "rgb(1, 2, 3)");
  await expect(tile(page).getByRole("button", { name: "Search", exact: true })).toHaveCSS("font-size", "16px");
  await expect(tile(page).getByRole("searchbox")).toHaveCSS("border-color", "rgb(18, 52, 86)");
  await expect(tile(page).getByRole("search")).toHaveAttribute("aria-label", `Search with ${engine_name}`);
  await expect(tile(page).locator(".search-widget__destination")).toHaveAttribute("title", `${engine_name} · https://duckduckgo.com/`);
});

test("Search dark and light previews", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1108, height: 570 });
  for (const footprint of FOOTPRINTS) for (const theme of ["dark", "light"] as const) {
    await configure(request, {}, theme, "", undefined, footprint); await page.goto("/"); await expect(tile(page).getByRole("searchbox")).toBeVisible();
    await expect.poll(() => tile(page).locator('img[src="/icons/search.svg"]').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    const name = `search${footprint.columnSpan === 3 ? "-compact" : ""}-${theme}`;
    await testInfo.attach(name, { body: await tile(page).screenshot({ path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/${name}.png` : undefined }), contentType: "image/png" });
  }
});
