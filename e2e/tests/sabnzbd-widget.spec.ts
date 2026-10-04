import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";
import { expectWidgetStatLayout, expectWidgetStatContrast } from "../helpers/widget-stat";

const TILE_DATA = schemaV2Fixtures([{
  name: "SABnzbd",
  description: "Download queue and speed",
  widget: { type: "sabnzbd", config: { url: "http://localhost:8080", apikey: "dummy" } },
}]);
const TILE_ID = TILE_DATA.service_tiles[0].id;
const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const STATS = { speedBytesPerSec: 5_500_000, queueCount: 4, totalMb: 1200, remainingMb: 800, timeLeft: "0:16:44", status: "Downloading" };
const FOOTPRINTS = [{ columnSpan: 3, rowSpan: 2 }, { columnSpan: 3, rowSpan: 4 }, { columnSpan: 6, rowSpan: 2 }] as const;
const RESPONSE = { ok: true, data: STATS };

test.use({ locale: "en-US" });

function tile(page: Page) {
  return page.locator(".service-tile").filter({ has: page.locator('[data-widget-type="sabnzbd"]') });
}

async function configure(request: APIRequestContext, options: {
  theme?: (typeof THEMES)[number]; custom_css?: string; name?: string; description?: string; footprint?: { columnSpan: number; rowSpan: number };
} = {}) {
  expect((await request.patch("/api/settings", { data: {
    ...TILE_DATA,
    service_tiles: TILE_DATA.service_tiles.map((tile) => ({ ...tile, footprint: options.footprint ?? { columnSpan: 3, rowSpan: 2 } })),
    services: TILE_DATA.services.map((service) => ({
      ...service, name: options.name ?? service.name, description: options.description ?? service.description,
    })),
    groups: [], bookmarks: [],
    appearance: { theme: options.theme ?? "dark", custom_css: options.custom_css },
  } })).ok()).toBe(true);
}

async function mockWidget(page: Page, response: unknown = RESPONSE) {
  await page.route("**/api/widget*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("tile_id") !== TILE_ID) return route.continue();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
}

async function layoutBounds(page: Page) {
  return tile(page).evaluate((element) => [element, ...element.querySelectorAll(".widget-stat")].map((node) => {
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x, y, width, height };
  }));
}

async function assertFits(page: Page, footprint = { columnSpan: 3, rowSpan: 2 }) {
  await expectWidgetStatLayout(tile(page), {
    width: footprint.columnSpan === 6 ? 688 : 340, height: footprint.rowSpan === 4 ? 264 : 128,
    columns: footprint.columnSpan === 6 ? 3 : 2, rows: footprint.rowSpan === 4 ? 3 : 1,
  });
}


function labelsFor(footprint: { columnSpan: number; rowSpan: number }) {
  return footprint.rowSpan === 4 ? ["↓ Speed", "Queue", "Queue Size", "Remaining", "ETA", "Status"]
    : footprint.columnSpan === 6 ? ["↓ Speed", "Queue", "Queue Size"] : ["↓ Speed", "Queue"];
}

function valuesFor(footprint: { columnSpan: number; rowSpan: number }) {
  return footprint.rowSpan === 4 ? ["5.5 MB/s", "4", "1.2 GB", "800.0 MB", "0:16:44", "Downloading"]
    : footprint.columnSpan === 6 ? ["5.5 MB/s", "4", "1.2 GB"] : ["5.5 MB/s", "4"];
}

test("SABnzbd uses two compact, three wide, and six detailed cards in every theme", async ({ page, request }, testInfo) => {
  await mockWidget(page);
  for (const footprint of FOOTPRINTS) {
    for (const theme of THEMES) {
      await configure(request, { theme, footprint });
      await page.goto("/");
      await expect(tile(page).locator(".widget-stat__label")).toHaveText(labelsFor(footprint));
      await expect(tile(page).locator(".widget-stat__value")).toHaveText(valuesFor(footprint));
      await expect(tile(page).locator(".widget-stat").first()).toHaveClass(/widget-stat--tone-positive/);
      await expect(tile(page).locator(".widget-stat").nth(1)).toHaveClass(/widget-stat--tone-warning/);
      await assertFits(page, footprint);
      await expectWidgetStatContrast(tile(page));
      const name = `sabnzbd-${footprint.columnSpan}x${footprint.rowSpan}-${theme}`;
      await testInfo.attach(name, { body: await tile(page).screenshot({
        path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/${name}.png` : undefined,
      }), contentType: "image/png" });
    }
  }
});

test("SABnzbd retains large values and accessible long service text", async ({ page, request }) => {
  const name = "SABnzbd download service with an intentionally long name";
  const description = "A deliberately long description of pending downloads and queue volume";
  await mockWidget(page, { ok: true, data: { speedBytesPerSec: 999_900_000, queueCount: 123456789,
    totalMb: 98765432.1, remainingMb: 87654321, timeLeft: "1234:56:00", status: "Waiting for post-processing" } });
  for (const footprint of FOOTPRINTS) {
    await configure(request, { name, description, footprint });
    await page.goto("/");
    await expect(tile(page).locator(".widget-stat")).toHaveCount(labelsFor(footprint).length);
    await expect(tile(page).locator(".widget-stat__value").first()).toHaveText("999.9 MB/s");
    await expect(tile(page).locator(".service-tile__name")).toHaveAttribute("title", name);
    await expect(tile(page).locator(".service-tile__description")).toHaveAttribute("title", description);
    await assertFits(page, footprint);
  }
});

test("SABnzbd keeps an empty queue neutral and absent details visible", async ({ page, request }) => {
  await configure(request, { footprint: { columnSpan: 3, rowSpan: 4 } });
  await mockWidget(page, { ok: true, data: { speedBytesPerSec: 0, queueCount: 0, totalMb: 0, status: "Idle" } });
  await page.goto("/");
  await expect(tile(page).locator(".widget-stat__value")).toHaveText(["0.0 KB/s", "0", "0.0 MB", "—", "—", "Idle"]);
  await expect(tile(page).locator(".widget-stat").nth(1)).toHaveClass(/widget-stat--tone-neutral/);
  await expect(tile(page).locator(".widget-stat").last()).toHaveClass(/widget-stat--tone-neutral/);
  await assertFits(page, { columnSpan: 3, rowSpan: 4 });
});

test("SABnzbd initial states use shared feedback and null data stays blank", async ({ page, request }) => {
  await configure(request);
  let releaseInitial!: () => void;
  const initial = new Promise<void>((resolve) => { releaseInitial = resolve; });
  let response: unknown = RESPONSE;
  await page.route("**/api/widget*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("tile_id") !== TILE_ID) return route.continue();
    await initial;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.goto("/");
  await expect(tile(page).getByRole("status", { name: "Loading widget" })).toHaveClass(/widget-state--loading/);
  releaseInitial();
  await expect(tile(page).locator(".widget-stat")).toHaveCount(2);
  response = { ok: false, error: "SABnzbd unavailable" };
  await page.reload();
  await expect(tile(page).getByRole("alert")).toHaveClass(/widget-state--error/);
  await expect(tile(page).getByRole("alert")).toHaveText("SABnzbd unavailable");
  response = { ok: true, data: null };
  await page.reload();
  await expect(tile(page).locator(".sabnzbd-widget--empty")).toBeEmpty();
});

test("SABnzbd refresh failure/recovery retains metrics and positions", async ({ page, request }) => {
  let fails = false;
  const error = "SABnzbd rejected the API key during refresh";
  await page.route("**/api/widget*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("tile_id") !== TILE_ID) return route.continue();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(fails ? { ok: false, error } : RESPONSE) });
  });
  await page.clock.install();
  for (const footprint of FOOTPRINTS) {
    for (const theme of THEMES) {
      fails = false;
      await configure(request, { footprint, theme });
      await page.goto("/");
      await expect(tile(page).locator(".widget-stat")).toHaveCount(labelsFor(footprint).length);
      const healthy = await layoutBounds(page);
      fails = true;
      await page.clock.fastForward(10_000);
      const alert = tile(page).getByRole("alert");
      await expect(alert).toHaveText("Refresh failed · saved data");
      await expect(alert).toHaveAccessibleName(`Refresh failed; saved data is shown. ${error}`);
      await expect(tile(page).locator(".widget-stat__value")).toHaveText(valuesFor(footprint));
      expect(await layoutBounds(page)).toEqual(healthy);
      await assertFits(page, footprint);
      fails = false;
      await page.clock.fastForward(10_000);
      await expect(alert).toHaveCount(0);
      expect(await layoutBounds(page)).toEqual(healthy);
    }
  }
});

test("ordinary custom CSS overrides SABnzbd shared cards and notice", async ({ page, request }) => {
  await configure(request, { custom_css: `
    .sabnzbd-widget__stat { background: #010203; border-radius: 12px; }
    .sabnzbd-widget__value { color: #040506; }
    .sabnzbd-widget__grid { gap: 10px; }
    .sabnzbd-widget { --widget-notice-padding-block: 3px; }
  ` });
  await mockWidget(page);
  await page.goto("/");
  await expect(tile(page).locator(".widget-stat")).toHaveCount(2);
  await expect(tile(page).locator(".widget-stat").first()).toHaveCSS("background-color", "rgb(1, 2, 3)");
  await expect(tile(page).locator(".widget-stat").first()).toHaveCSS("border-radius", "12px");
  await expect(tile(page).locator(".widget-stat__value").first()).toHaveCSS("color", "rgb(4, 5, 6)");
  await expect(tile(page).locator(".widget-stat-grid")).toHaveCSS("gap", "10px");
  await expect(tile(page).locator(".widget-body__notice")).toHaveCSS("padding-top", "3px");
  await assertFits(page);
});

test("SABnzbd compact, detailed and wide previews match the library design", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1108, height: 780 });
  const reference = schemaV2Fixtures([
    { name: "qBittorrent", description: "Download and upload speeds", size: "normal", widget: { type: "qbittorrent-stats", config: { url: "http://localhost:8081", username: "admin", password: "dummy" } } },
    { name: "SABnzbd", description: "Speed and pending downloads", size: "normal", widget: { type: "sabnzbd", config: { url: "http://localhost:8080", apikey: "dummy" } } },
    { name: "SABnzbd · Detailed", description: "Queue, remaining size and ETA", size: "tall", widget: { type: "sabnzbd", config: { url: "http://localhost:8080", apikey: "dummy" } } },
    { name: "SABnzbd · Wide", description: "Speed, queue and total size", size: "wide", widget: { type: "sabnzbd", config: { url: "http://localhost:8080", apikey: "dummy" } } },
  ]);
  await page.route("**/api/widget*", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("tile_id");
    if (!reference.service_tiles.some((entry) => entry.id === id)) return route.continue();
    const response = id === reference.service_tiles[0].id
      ? { ok: true, data: { dl_info_speed: 5_500_000, up_info_speed: 500_000, dl_info_data: 1200000000, up_info_data: 345000000, activity: null } }
      : RESPONSE;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  for (const theme of ["dark", "light"] as const) {
    expect((await request.patch("/api/settings", { data: { ...reference, groups: [], bookmarks: [], appearance: { theme } } })).ok()).toBe(true);
    await page.goto("/");
    await expect(page.locator(".widget-stat")).toHaveCount(13);
    const metrics = async (widget: string) => page.locator(`[data-widget-type="${widget}"] .widget-stat`).first().evaluate((element) => {
      const style = getComputedStyle(element);
      return { padding: style.padding, radius: style.borderRadius, height: element.getBoundingClientRect().height,
        valueFontSize: getComputedStyle(element.querySelector(".widget-stat__value")!).fontSize,
        labelFontSize: getComputedStyle(element.querySelector(".widget-stat__label")!).fontSize };
    });
    expect(await metrics("sabnzbd")).toEqual(await metrics("qbittorrent-stats"));
    await testInfo.attach(`SABnzbd-comparison-${theme}`, { body: await page.locator(".dashboard-tile-grid").screenshot({
      path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/sabnzbd-comparison-${theme}.png` : undefined,
    }), contentType: "image/png" });
  }
});
