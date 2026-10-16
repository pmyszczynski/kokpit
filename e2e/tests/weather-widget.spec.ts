import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { expectWidgetStatLayout, expectWidgetStatContrast } from "../helpers/widget-stat";
import type { WeatherData } from "../../src/integrations/weather/api";

const FOOTPRINTS = [{ columnSpan: 3, rowSpan: 2 }, { columnSpan: 6, rowSpan: 2 }, { columnSpan: 6, rowSpan: 4 }];
const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const DATA: WeatherData = { temperature: 18.4, feelsLike: 17.6, humidity: 64, wind: 12, code: 2, isDay: true,
  imperial: false, observedAt: "2026-10-16T12:15", timezone: "Europe/London",
  forecast: Array.from({ length: 5 }, (_, i) => ({ date: `2026-10-${16 + i}`, high: 20 - i, low: 12 - i, precipitation: [20, 65, 10, 0, 80][i], code: [2, 61, 3, 0, 95][i] })) };
function fixtures(footprints = [FOOTPRINTS[0]], imperial = false) {
  return {
    services: footprints.map((_, i) => ({ id: `10000000-0000-4000-8000-00000000000${i}`, name: `London · ${["Compact", "Wide", "Detailed"][i]}`, description: "Current weather and forecast" })),
    service_tiles: footprints.map((footprint, i) => ({ id: `20000000-0000-4000-8000-00000000000${i}`, service_id: `10000000-0000-4000-8000-00000000000${i}`, footprint, widget: { type: "weather", config: { latitude: 51.5074, longitude: -0.1278, imperial } } })),
  };
}
async function configure(request: APIRequestContext, options: { footprints?: typeof FOOTPRINTS; theme?: typeof THEMES[number]; custom_css?: string; imperial?: boolean } = {}) {
  expect((await request.patch("/api/settings", { data: { ...fixtures(options.footprints, options.imperial), groups: [], bookmarks: [], appearance: { theme: options.theme ?? "dark", custom_css: options.custom_css } } })).ok()).toBe(true);
}
const tile = (page: Page) => page.locator('.service-tile').filter({ has: page.locator('[data-widget-type="weather"]') });
async function mock(page: Page, data: WeatherData = DATA) {
  await page.route("**/api/widget?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) }));
}
test.use({ locale: "en-US" });

test("Weather has 2/3/6 shared stats, complete text and contrast at every size/theme", async ({ page, request }) => {
  await mock(page);
  for (const footprint of FOOTPRINTS) for (const theme of THEMES) {
    await configure(request, { footprints: [footprint], theme }); await page.goto("/");
    await expect(tile(page).locator(".widget-stat")).toHaveCount(footprint.rowSpan === 4 ? 6 : footprint.columnSpan === 6 ? 3 : 2);
    await expectWidgetStatLayout(tile(page), { width: footprint.columnSpan === 6 ? 688 : 340, height: footprint.rowSpan === 4 ? 264 : 128, columns: footprint.columnSpan === 6 ? 3 : 2, rows: footprint.rowSpan === 4 ? 2 : 1 });
    await expectWidgetStatContrast(tile(page));
    await expect(tile(page).getByRole("link", { name: "Weather by Open-Meteo" })).toBeVisible();
  }
});

test("Weather keeps partial values explicit and uses requested imperial labels", async ({ page, request }) => {
  await configure(request, { footprints: [FOOTPRINTS[2]], imperial: true });
  await mock(page, { ...DATA, imperial: true, temperature: -4.2, feelsLike: null, humidity: 0, wind: 0, code: 999, forecast: [] });
  await page.goto("/");
  await expect(tile(page).locator(".widget-stat__value")).toHaveText(["-4°F", "Unknown", "—", "0%", "0 mph", "—"]);
  await expect(tile(page).getByText("Forecast unavailable")).toBeVisible();
  await expect(tile(page).locator(".widget-stat").nth(1)).toHaveClass(/tone-neutral/);
});

test("Weather forecast scrolls by keyboard while current stats and attribution stay fixed", async ({ page, request }) => {
  await mock(page);
  for (const theme of THEMES) {
    await configure(request, { footprints: [FOOTPRINTS[2]], theme }); await page.goto("/");
    const list = tile(page).getByRole("list", { name: "Five-day weather forecast" });
    await expect(list.locator("li")).toHaveCount(5);
    const header = await tile(page).locator(".widget-stat-grid").boundingBox();
    const footer = await tile(page).locator(".widget-body__notice").boundingBox();
    await list.focus(); await list.press("End");
    await expect.poll(() => list.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) < 2)).toBe(true);
    await expect.poll(() => list.evaluate(element => {
      const last = element.lastElementChild!.getBoundingClientRect(); const region = element.getBoundingClientRect();
      return last.bottom <= region.bottom + 1 && last.top >= region.top - 1;
    })).toBe(true);
    expect(await tile(page).locator(".widget-stat-grid").boundingBox()).toEqual(header);
    expect(await tile(page).locator(".widget-body__notice").boundingBox()).toEqual(footer);
    expect(await list.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
});

test("Weather initial loading, error and null states use shared feedback", async ({ page, request }) => {
  await configure(request);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let response: unknown = { ok: false, error: "Weather provider unavailable" };
  await page.route("**/api/widget?*", async route => { await gate; await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) }); });
  await page.goto("/"); await expect(tile(page).getByRole("status", { name: "Loading widget" })).toBeVisible();
  release(); await expect(tile(page).getByRole("alert")).toHaveText("Weather provider unavailable");
  response = { ok: true, data: null }; await page.reload(); await expect(tile(page).getByText("Weather unavailable")).toBeVisible();
});

test("Weather stale refresh retains all data and geometry, then recovers after ten minutes", async ({ page, request }) => {
  let fails = false;
  await page.route("**/api/widget?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(fails ? { ok: false, error: "Provider unavailable" } : { ok: true, data: DATA }) }));
  await page.clock.install();
  for (const footprint of FOOTPRINTS) {
    fails = false; await configure(request, { footprints: [footprint] }); await page.goto("/");
    await expect(tile(page).locator(".widget-stat").first()).toHaveText(/18°C/);
    const bounds = await tile(page).locator(".widget-stat-grid").boundingBox();
    fails = true; await page.clock.fastForward(600_000);
    await expect(tile(page).getByRole("alert")).toHaveAccessibleName("Refresh failed; saved data is shown. Provider unavailable");
    expect(await tile(page).locator(".widget-stat-grid").boundingBox()).toEqual(bounds);
    await expect(tile(page).locator(".widget-stat").first()).toHaveText(/18°C/);
    fails = false; await page.clock.fastForward(600_000); await expect(tile(page).getByRole("alert")).toHaveCount(0);
    expect(await tile(page).locator(".widget-stat-grid").boundingBox()).toEqual(bounds);
  }
});

test("ordinary custom CSS overrides Weather shared cards, forecast rows and notice", async ({ page, request }) => {
  await configure(request, { footprints: [FOOTPRINTS[2]], custom_css: ".weather-widget__stat { background: #010203; border-radius: 12px; } .weather-widget__forecast .widget-list-item { border-color: #123456; } .weather-widget { --widget-notice-padding-block: 3px; }" });
  await mock(page); await page.goto("/");
  await expect(tile(page).locator(".widget-stat").first()).toHaveCSS("background-color", "rgb(1, 2, 3)");
  await expect(tile(page).locator(".widget-stat").first()).toHaveCSS("border-radius", "12px");
  await expect(tile(page).locator(".widget-list-item").first()).toHaveCSS("border-color", "rgb(18, 52, 86)");
  await expect(tile(page).locator(".widget-body__notice")).toHaveCSS("padding-top", "3px");
});

test("Weather preset saves fractional coordinates and units as tile options without a connection", async ({ page, request }) => {
  expect((await request.patch("/api/settings", { data: { services: [], service_tiles: [], groups: [{ name: "Weather" }], bookmarks: [], appearance: { theme: "dark" } } })).ok()).toBe(true);
  await mock(page, { ...DATA, imperial: true }); await page.goto("/");
  await page.getByRole("button", { name: "Edit dashboard" }).click();
  await page.getByRole("button", { name: "Add tile to Weather" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Weather", exact: true }).click();
  await expect(page.getByLabel("Footprint", { exact: true })).toHaveValue("3x2");
  await page.getByLabel("Latitude *", { exact: true }).fill("51.5074");
  await page.getByLabel("Longitude *", { exact: true }).fill("-0.1278");
  await page.getByLabel("Use imperial units").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const saved = page.waitForResponse(r => r.url().endsWith("/api/settings") && r.request().method() === "PATCH");
  await page.getByRole("button", { name: /Save & exit/ }).click(); expect((await saved).ok()).toBe(true);
  await expect(page.locator(".edit-bar")).toBeHidden();
  const persisted = await (await request.get("/api/settings")).json();
  expect(persisted.service_tiles[0]).toMatchObject({ footprint: FOOTPRINTS[0], widget: { type: "weather", config: { latitude: 51.5074, longitude: -0.1278, imperial: true } } });
  expect(persisted.services[0].integration).toBeUndefined();
  await page.reload(); await expect(tile(page).locator(".widget-stat__value").first()).toHaveText("18°F");
});

test("Weather dark/light previews show Compact, Wide and Detailed", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1108, height: 780 }); await mock(page);
  for (const theme of ["dark", "light"] as const) {
    await configure(request, { footprints: FOOTPRINTS, theme }); await page.goto("/");
    await expect(page.locator(".widget-stat")).toHaveCount(11);
    await expect(page.locator(".widget-list-item")).toHaveCount(5);
    await testInfo.attach(`Weather-${theme}`, { body: await page.locator(".dashboard-tile-grid").screenshot({
      path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/weather-${theme}.png` : undefined,
    }), contentType: "image/png" });
  }
});
