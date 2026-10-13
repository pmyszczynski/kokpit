import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";
import { expectWidgetStatLayout, expectWidgetStatContrast } from "../helpers/widget-stat";

const FIXTURE = schemaV2Fixtures([{ name: "Unraid", description: "Array health and storage", widget: {
  type: "unraid-stats", config: { url: "http://unraid.local", api_key: "dummy" },
} }]);
const TILE_ID = FIXTURE.service_tiles[0].id;
const STATS = { arrayState: "STARTED", totalBytes: 24 * 1024 ** 4, usedBytes: 12.4 * 1024 ** 4,
  diskCount: 6, diskErrors: 0, parityStatus: "", parityErrors: 0, parityDate: "2026-10-10" };
const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const FOOTPRINTS = [{ columnSpan: 3, rowSpan: 2 }, { columnSpan: 6, rowSpan: 2 },
  { columnSpan: 3, rowSpan: 4 }, { columnSpan: 6, rowSpan: 4 }];
type Footprint = typeof FOOTPRINTS[number];
const RESPONSE = { ok: true, data: STATS };

function tile(page: Page) {
  return page.locator(".service-tile").filter({ has: page.locator('[data-widget-type="unraid-stats"]') });
}
async function configure(request: APIRequestContext, options: {
  footprint?: Footprint; theme?: typeof THEMES[number]; custom_css?: string; name?: string;
} = {}) {
  expect((await request.patch("/api/settings", { data: { ...FIXTURE,
    services: FIXTURE.services.map(service => ({ ...service, name: options.name ?? service.name })),
    service_tiles: FIXTURE.service_tiles.map(entry => ({ ...entry, footprint: options.footprint ?? FOOTPRINTS[0] })),
    groups: [], bookmarks: [], appearance: { theme: options.theme ?? "dark", custom_css: options.custom_css },
  } })).ok()).toBe(true);
}
async function mockWidget(page: Page, response: unknown = RESPONSE) {
  await page.route("**/api/widget*", async route => {
    if (new URL(route.request().url()).searchParams.get("tile_id") !== TILE_ID) return route.continue();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
}
function fields(footprint: Footprint) {
  return footprint.rowSpan === 4 ? ["array", "used", "disks", "errors", "parity", "parityErrors"]
    : footprint.columnSpan === 6 ? ["array", "used", "errors"] : ["array", "used"];
}
async function assertFits(page: Page, footprint: Footprint) {
  await expectWidgetStatLayout(tile(page), { width: footprint.columnSpan === 6 ? 688 : 340,
    height: footprint.rowSpan === 4 ? 264 : 128, columns: footprint.columnSpan === 6 ? 3 : 2,
    rows: footprint.rowSpan === 4 ? footprint.columnSpan === 6 ? 2 : 3 : 1 });
  const scroll = tile(page).getByRole("region", { name: "Unraid measurements" });
  expect(await scroll.evaluate(node => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight)).toBe(true);
}

test("Unraid has 2/3/6 shared cards with consistent colors and fit in four themes", async ({ page, request }) => {
  await mockWidget(page);
  for (const footprint of FOOTPRINTS) for (const theme of THEMES) {
    await configure(request, { footprint, theme });
    await page.goto("/");
    await expect(tile(page).locator(".widget-stat")).toHaveCount(fields(footprint).length);
    expect(await tile(page).locator(".widget-stat").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-field")))).toEqual(fields(footprint));
    await expect(tile(page).locator('[data-field="array"]')).toHaveClass(/widget-stat--tone-positive/);
    await expect(tile(page).locator('[data-field="used"]')).toHaveClass(/widget-stat--tone-info/);
    await expect(tile(page).locator('[data-field="used"] .widget-stat__supporting-value')).toHaveText("/ 24.0 TiB");
    if (footprint.rowSpan === 4) {
      await expect(tile(page).locator('[data-field="parity"]')).toHaveClass(/widget-stat--tone-positive/);
      await expect(tile(page).locator('[data-field="parity"] .widget-stat__supporting-value')).toHaveText("2026-10-10");
      await expect(tile(page).locator('[data-field="parityErrors"]')).toHaveClass(/widget-stat--tone-neutral/);
    }
    await assertFits(page, footprint);
    await expectWidgetStatContrast(tile(page));
    const supporting = await tile(page).locator(".widget-stat__supporting-value").evaluateAll(nodes => nodes.map(node => {
      const rgb = (color: string) => color.match(/\d+(?:\.\d+)?/g)!.slice(0, 3).map(Number).map(channel => {
        const v = channel / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
      }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const l = [rgb(getComputedStyle(node).color), rgb(getComputedStyle(node.closest(".widget-stat")!).backgroundColor)].sort((a,b) => b-a);
      return (l[0]+.05)/(l[1]+.05);
    }));
    expect(Math.min(...supporting)).toBeGreaterThanOrEqual(4.5);
  }
});

test("Unraid keeps reported problems visible in Compact and Detailed", async ({ page, request }) => {
  await mockWidget(page, { ok: true, data: { ...STATS, diskErrors: 2, parityErrors: 3 } });
  for (const footprint of FOOTPRINTS) for (const theme of THEMES) {
    await configure(request, { footprint, theme }); await page.goto("/");
    const array = tile(page).locator('[data-field="array"]');
    if (footprint.rowSpan === 4) {
      await expect(array).toHaveClass(/widget-stat--tone-positive/);
      await expect(array.locator(".widget-stat__supporting-value")).toHaveCount(0);
      await expect(tile(page).locator('[data-field="errors"]')).toHaveClass(/widget-stat--tone-alert/);
      await expect(tile(page).locator('[data-field="parityErrors"] .widget-stat__value')).toHaveText("3");
    } else {
      await expect(array).toHaveClass(/widget-stat--tone-alert/);
      await expect(array.locator(".widget-stat__label")).toHaveText("Needs attention");
      await expect(array.locator(".widget-stat__supporting-value")).toHaveCount(0);
    }
    const value = array.locator(".widget-stat__value");
    await value.focus();
    await expect(value).toHaveAccessibleDescription("Array: Started; disk errors: 2; parity errors: 3");
    await expect(array.getByRole("tooltip")).toBeVisible();
    await page.keyboard.press("Escape"); await value.blur();
    await expectWidgetStatContrast(tile(page));
    await assertFits(page, footprint);
  }
});

test("Unraid preserves missing parity, stopped states and running check meanings", async ({ page, request }) => {
  await configure(request, { footprint: FOOTPRINTS[2] });
  let data = { ...STATS, arrayState: "STOPPED", parityStatus: null as string | null, parityErrors: null as number | null, parityDate: null as string | null };
  await page.route("**/api/widget*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) }));
  await page.goto("/");
  for (const field of ["array", "errors", "parity", "parityErrors"]) await expect(tile(page).locator(`[data-field="${field}"]`)).toHaveClass(/widget-stat--tone-neutral/);
  for (const field of ["parity", "parityErrors"]) await expect(tile(page).locator(`[data-field="${field}"] .widget-stat__value`)).toContainText("—");
  data = { ...STATS, parityStatus: "STARTED" };
  await page.reload();
  await expect(tile(page).locator('[data-field="parity"]')).toHaveClass(/widget-stat--tone-warning/);
  await assertFits(page, FOOTPRINTS[2]);
});

test("Unraid long states and supporting details remain reachable by keyboard", async ({ page, request }) => {
  const state = "STOPPED_INVALID_DISK_CONFIGURATION_REQUIRES_ATTENTION";
  const date = "Last parity check finished on 2026-10-10 with a deliberately long server-reported description";
  await configure(request, { footprint: FOOTPRINTS[2], name: "Unraid storage server with an intentionally long name" });
  await mockWidget(page, { ok: true, data: { ...STATS, arrayState: state, parityStatus: state, parityDate: date,
    diskCount: 123456789, diskErrors: 12345678, parityErrors: 12345678, usedBytes: 999999 * 1024 ** 4, totalBytes: 1999999 * 1024 ** 4 } });
  await page.goto("/");
  await expect(tile(page).locator(".widget-stat")).toHaveCount(6);
  const scroll = tile(page).getByRole("region", { name: "Unraid measurements" });
  await scroll.focus(); await page.keyboard.press("End");
  await expect(tile(page).getByText("Parity Errors", { exact: true })).toBeInViewport();
  expect(await scroll.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  const parity = tile(page).locator('[data-field="parity"] .widget-stat__value');
  await parity.focus();
  await expect(tile(page).getByRole("tooltip").filter({ hasText: date })).toBeVisible();
  await expect(parity).toHaveAccessibleDescription(new RegExp(date));
  await page.keyboard.press("Escape");
  await expect(tile(page).getByRole("tooltip").filter({ hasText: date })).toBeHidden();
});

test("Unraid uses shared loading/error/empty feedback", async ({ page, request }) => {
  await configure(request);
  let release!: () => void;
  const initial = new Promise<void>(resolve => { release = resolve; });
  let response: unknown = RESPONSE;
  await page.route("**/api/widget*", async route => {
    await initial; await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.goto("/");
  await expect(tile(page).getByRole("status", { name: "Loading widget" })).toHaveClass(/widget-state--loading/);
  release(); await expect(tile(page).locator(".widget-stat")).toHaveCount(2);
  response = { ok: false, error: "Unraid unavailable" }; await page.reload();
  await expect(tile(page).getByRole("alert")).toHaveText("Unraid unavailable");
  response = { ok: true, data: null }; await page.reload();
  await expect(tile(page).locator(".unraid-stats-widget--empty")).toBeEmpty();
});

test("Unraid retains saved measurements and geometry through 30-second refresh recovery", async ({ page, request }) => {
  let fails = false;
  await page.route("**/api/widget*", route => route.fulfill({ contentType: "application/json",
    body: JSON.stringify(fails ? { ok: false, error: "Unraid API key rejected" } : RESPONSE) }));
  await page.clock.install();
  for (const footprint of FOOTPRINTS) for (const theme of ["dark", "light"] as const) {
    fails = false; await configure(request, { footprint, theme }); await page.goto("/");
    await expect(tile(page).locator(".widget-stat")).toHaveCount(fields(footprint).length);
    const bounds = () => tile(page).locator(".widget-stat").evaluateAll(nodes => nodes.map(node => {
      const { x,y,width,height } = node.getBoundingClientRect(); return { x,y,width,height };
    }));
    const before = await bounds();
    fails = true; await page.clock.fastForward(30000);
    await expect(tile(page).getByRole("alert")).toHaveAccessibleName("Refresh failed; saved data is shown. Unraid API key rejected");
    expect(await bounds()).toEqual(before);
    await assertFits(page, footprint);
    fails = false; await page.clock.fastForward(30000);
    await expect(tile(page).getByRole("alert")).toHaveCount(0);
    expect(await bounds()).toEqual(before);
  }
});

test("ordinary custom CSS overrides Unraid shared cards and supporting values", async ({ page, request }) => {
  await configure(request, { custom_css: ".unraid-stats-widget__stat { background: #010203; border-radius: 12px; } .unraid-stats-widget__value { color: #040506; } .unraid-stats-widget__sub { color: #070809; } .unraid-stats-widget__grid { gap: 10px; }" });
  await mockWidget(page); await page.goto("/");
  await expect(tile(page).locator(".widget-stat").first()).toHaveCSS("background-color", "rgb(1, 2, 3)");
  await expect(tile(page).locator(".widget-stat").first()).toHaveCSS("border-radius", "12px");
  await expect(tile(page).locator(".widget-stat__value").first()).toHaveCSS("color", "rgb(4, 5, 6)");
  await expect(tile(page).locator(".unraid-stats-widget__sub")).toHaveCSS("color", "rgb(7, 8, 9)");
  await assertFits(page, FOOTPRINTS[0]);
});

test("Unraid dark and light previews show the three sizes, errors and missing parity", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1108, height: 780 });
  const previews = schemaV2Fixtures(["Compact", "Wide", "Detailed", "Disk & parity errors", "No parity data"].map(name => ({
    name: `Unraid · ${name}`, widget: { type: "unraid-stats", config: { url: "http://unraid.local", api_key: "dummy" } },
  })));
  await page.route("**/api/widget*", route => {
    const id = new URL(route.request().url()).searchParams.get("tile_id");
    const index = previews.service_tiles.findIndex(entry => entry.id === id);
    const data = index < 2 || index === 3 ? { ...STATS, diskErrors: 2, parityErrors: 3 }
      : index === 4 ? { ...STATS, parityStatus: null, parityErrors: null, parityDate: null } : STATS;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  });
  for (const theme of ["dark", "light"] as const) {
    expect((await request.patch("/api/settings", { data: { ...previews,
      service_tiles: previews.service_tiles.map((entry,index) => ({ ...entry, footprint: index < 2 ? FOOTPRINTS[index] : FOOTPRINTS[2] })),
      groups: [], bookmarks: [], appearance: { theme },
    } })).ok()).toBe(true);
    await page.goto("/");
    await expect(page.locator(".widget-stat")).toHaveCount(23);
    await testInfo.attach(`Unraid-${theme}`, { body: await page.locator(".dashboard-tile-grid").screenshot({
      path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/unraid-${theme}.png` : undefined,
    }), contentType: "image/png" });
  }
});

test("Unraid preset saves its untouched Compact default through the real editor", async ({ page, request }) => {
  expect((await request.patch("/api/settings", { data: { services: [], service_tiles: [], groups: [{ name: "Infra" }], bookmarks: [], appearance: { theme: "dark" } } })).ok()).toBe(true);
  await page.route("**/api/widget*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(RESPONSE) }));
  await page.goto("/");
  await page.getByRole("button", { name: "Edit dashboard" }).click();
  await page.getByRole("button", { name: "Add tile to Infra" }).click();
  await page.getByRole("button", { name: "Unraid Stats", exact: true }).click();
  await expect(page.getByLabel("Footprint", { exact: true })).toHaveValue("3x2");
  await page.getByLabel("URL *", { exact: true }).fill("http://unraid.local");
  await page.getByLabel("API Key *", { exact: true }).fill("dummy");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const saved = page.waitForResponse(response => response.url().endsWith("/api/settings") && response.request().method() === "PATCH");
  await page.getByRole("button", { name: /Save & exit/ }).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.locator(".edit-bar")).toBeHidden();
  const persisted = await (await request.get("/api/settings")).json();
  expect(persisted.service_tiles).toHaveLength(1);
  expect(persisted.service_tiles[0].footprint).toEqual({ columnSpan: 3, rowSpan: 2 });
  await page.reload();
  await expect(tile(page).locator(".widget-stat")).toHaveCount(2);
  await assertFits(page, FOOTPRINTS[0]);
});
