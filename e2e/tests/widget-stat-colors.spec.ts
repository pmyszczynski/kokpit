import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { schemaV2Fixtures } from "../helpers/schema-v2";

const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const FIXTURES = schemaV2Fixtures([
  { name: "qBittorrent", description: "Transfer rates and activity", size: "tall", widget: { type: "qbittorrent-stats", config: { url: "http://localhost:8080", username: "admin", password: "dummy" } } },
  { name: "Prowlarr", description: "Indexer health and grabs", widget: { type: "prowlarr-stats", config: { url: "http://localhost:9696", api_key: "dummy" } } },
  { name: "Radarr", description: "Movie library and downloads", widget: { type: "radarr-stats", config: { url: "http://localhost:7878", api_key: "dummy" } } },
  { name: "Immich", description: "Photo library and storage", widget: { type: "immich-stats", config: { url: "http://localhost:2283/api", api_key: "dummy" } } },
]);
const DATA = [
  { dl_info_speed: 5_500_000, up_info_speed: 500_000, dl_info_data: 450_000_000_000, up_info_data: 125_000_000_000, activity: { active: 16, inactive: 4 } },
  { totalIndexers: 12, enabledIndexers: 11, failingIndexers: 1, totalGrabs: 1234, usenetIndexers: 8, torrentIndexers: 4 },
  { missing: 18, upcoming: 12, wanted: 30, queued: 4, available: 1180, total: 1250 },
  { usage: 1_500_000_000_000, photos: 34560, videos: 720 },
];

function card(page: Page, widget: string, label: string) {
  return page.locator(`[data-widget-type="${widget}"] .widget-stat`).filter({
    has: page.locator(".widget-stat__label").filter({ hasText: new RegExp(`^${label}$`) }),
  });
}

async function configure(request: APIRequestContext, theme: (typeof THEMES)[number]) {
  expect((await request.patch("/api/settings", { data: {
    ...FIXTURES, groups: [], bookmarks: [], appearance: { theme },
  } })).ok()).toBe(true);
}

async function mockWidgets(page: Page, data: unknown[] = DATA) {
  await page.route("**/api/widget*", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("tile_id");
    const index = FIXTURES.service_tiles.findIndex((tile) => tile.id === id);
    if (index < 0) return route.continue();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: data[index] }) });
  });
}

async function assertContrast(page: Page) {
  const minimum = await page.locator(".widget-stat").evaluateAll((cards) => {
    const luminance = (color: string) => color.match(/\d+(?:\.\d+)?/g)!.slice(0, 3).map(Number)
      .map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    return Math.min(...cards.flatMap((card) => Array.from(card.children).map((text) => {
      const values = [luminance(getComputedStyle(text).color), luminance(getComputedStyle(card).backgroundColor)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    })));
  });
  expect(minimum).toBeGreaterThanOrEqual(4.5);
}

test("migrated stat widgets use consistent, readable colors in every theme", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1108, height: 850 });
  await mockWidgets(page);
  const groups = [
    { tone: "positive", entries: [["qbittorrent-stats", "↓ Speed"], ["qbittorrent-stats", "↓ Total"], ["qbittorrent-stats", "Active"], ["prowlarr-stats", "Enabled"], ["radarr-stats", "Available"]] },
    { tone: "info", entries: [["qbittorrent-stats", "↑ Speed"], ["qbittorrent-stats", "↑ Total"], ["prowlarr-stats", "Indexers"], ["prowlarr-stats", "Total Grabs"], ["prowlarr-stats", "Usenet"], ["prowlarr-stats", "Torrent"], ["radarr-stats", "Upcoming"], ["radarr-stats", "Total"], ["immich-stats", "Storage"], ["immich-stats", "Items"]] },
    { tone: "warning", entries: [["radarr-stats", "Wanted"], ["radarr-stats", "Queued"]] },
    { tone: "alert", entries: [["prowlarr-stats", "Failing"], ["radarr-stats", "Missing"]] },
    { tone: "neutral", entries: [["qbittorrent-stats", "Inactive"]] },
  ];
  for (const theme of THEMES) {
    await configure(request, theme);
    await page.goto("/");
    await expect(page.locator(".widget-stat")).toHaveCount(20);
    for (const { tone, entries } of groups) {
      const colors = [];
      for (const [widget, label] of entries) {
        const item = card(page, widget, label);
        await expect(item).toHaveClass(new RegExp(`widget-stat--tone-${tone}(?: |$)`));
        colors.push(await item.locator(".widget-stat__value").evaluate((node) => getComputedStyle(node).color));
      }
      expect(new Set(colors).size).toBe(1);
    }
    await assertContrast(page);
    await testInfo.attach(`stat-colors-${theme}`, {
      body: await page.locator(".dashboard-tile-grid").screenshot({
        path: process.env.KOKPIT_WIDGET_PREVIEW_DIR
          ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/stat-colors-${theme}.png` : undefined,
      }), contentType: "image/png",
    });
  }
});

test("zero pending/problem counts and unavailable activity retain neutral colors", async ({ page, request }) => {
  const data: unknown[] = [
    { ...DATA[0], activity: { active: 0, inactive: 0 } },
    { ...DATA[1], failingIndexers: 0, usenetIndexers: 0, torrentIndexers: 0 },
    { ...DATA[2], missing: 0, wanted: 0, queued: 0 },
    DATA[3],
  ];
  await configure(request, "dark");
  await mockWidgets(page, data);
  await page.goto("/");
  await expect(page.locator(".widget-stat")).toHaveCount(20);
  for (const [widget, label] of [["prowlarr-stats", "Failing"], ["radarr-stats", "Missing"], ["radarr-stats", "Wanted"], ["radarr-stats", "Queued"], ["qbittorrent-stats", "Active"]]) {
    await expect(card(page, widget, label)).toHaveClass(/widget-stat--tone-neutral/);
    await expect(card(page, widget, label).locator(".widget-stat__value")).toHaveText("0");
  }
  for (const label of ["Usenet", "Torrent"]) {
    await expect(card(page, "prowlarr-stats", label)).toHaveClass(/widget-stat--tone-info/);
    await expect(card(page, "prowlarr-stats", label).locator(".widget-stat__value")).toHaveText("0");
  }
  data[0] = { ...DATA[0], activity: null };
  await page.reload();
  await expect(page.locator('[data-widget-type="qbittorrent-stats"]').getByRole("status")).toHaveText("Activity unavailable");
  for (const label of ["Active", "Inactive"]) {
    await expect(card(page, "qbittorrent-stats", label)).toHaveClass(/widget-stat--tone-neutral/);
    await expect(card(page, "qbittorrent-stats", label).locator(".widget-stat__value")).toHaveText("—");
  }
});
