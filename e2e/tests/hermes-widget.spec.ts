import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createServer } from "node:http";
import type { HermesData } from "../../src/integrations/hermes/api";

const FOOTPRINTS = [{ columnSpan: 3, rowSpan: 4 }, { columnSpan: 6, rowSpan: 3 }];
const THEMES = ["dark", "light", "oled", "high-contrast"] as const;
const DATA: HermesData = { health: "ready", activeApiRuns: 2, jobsState: "available", scheduledJobs: 3, failedJobs: 1,
  nextJob: { name: "Daily homelab report", nextRun: "2026-10-21T06:00:00Z", lastStatus: "ok" }, sessionsState: "available",
  sessions: ["Check backup integrity", "Investigate slow media server", "Summarize overnight activity", "Review container updates", "Plan a storage upgrade", "Compare local models", "Investigate a very long session title whose full text must remain accessible even in the narrow footprint", "Check network connectivity", "Prepare weekly maintenance", "Review yesterday’s alerts"].map((title, i) => ({ id: `session-${i}`, title, source: ["telegram", "cli", "api_server"][i % 3], lastActive: `2026-10-20T${String(11 - i).padStart(2, "0")}:00:00Z` })) };
function fixtures(footprints = [FOOTPRINTS[0]], url = "http://hermes:8642") {
  return { services: footprints.map((_, i) => ({ id: `10000000-0000-4000-8000-00000000000${i}`, name: `Hermes · ${i === 0 ? "Default" : "Wide"}`, description: "AI agent", icon: "/icons/hermes.svg", launch_url: "https://hermes.example/dashboard", integration: { type: "hermes", config: { url, api_key: "hermes-test-secret" } } })),
    service_tiles: footprints.map((footprint, i) => ({ id: `20000000-0000-4000-8000-00000000000${i}`, service_id: `10000000-0000-4000-8000-00000000000${i}`, footprint, widget: { type: "hermes-overview" } })) };
}
async function configure(request: APIRequestContext, footprints = [FOOTPRINTS[0]], theme: typeof THEMES[number] = "dark", custom_css?: string, url?: string) {
  expect((await request.patch("/api/settings", { data: { ...fixtures(footprints, url), groups: [], bookmarks: [], appearance: { theme, custom_css } } })).ok()).toBe(true);
}
const tile = (page: Page) => page.locator('.service-tile').filter({ has: page.locator('[data-widget-type="hermes-overview"]') });
async function mock(page: Page, data: HermesData | null = DATA) {
  await page.route("**/api/widget?*", route => route.fulfill({ json: { ok: true, data } }));
  await page.route("**/api/ping", route => route.fulfill({ json: { ok: true, status: 200 } }));
}

test("Hermes fits 3×4 and 6×3 in all themes with a fixed summary and keyboard-scrollable activity", async ({ page, request }) => {
  await mock(page);
  for (const footprint of FOOTPRINTS) for (const theme of THEMES) {
    await configure(request, [footprint], theme); await page.goto("/");
    const widget = tile(page); const list = widget.getByRole("list", { name: "Hermes activity" });
    await expect(list.getByRole("listitem")).toHaveCount(11);
    await expect(widget.getByText("Ready", { exact: true })).toBeVisible(); await expect(widget.getByText("1 failed job")).toBeVisible();
    expect(await list.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const items = list.getByRole("listitem");
    const first = await items.nth(0).boundingBox(); const second = await items.nth(1).boundingBox();
    expect(Math.abs(first!.y - second!.y) < 1).toBe(footprint.columnSpan === 6);
    const bounds = await widget.locator(".widget-list__summary").first().boundingBox();
    await list.focus(); await list.press("End");
    await expect.poll(() => list.evaluate(el => el.scrollTop > 0 && Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2)).toBe(true);
    expect(await list.evaluate(el => el.lastElementChild!.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 1)).toBe(true);
    await list.press("Home"); await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(0);
    expect(await widget.locator(".widget-list__summary").first().boundingBox()).toEqual(bounds);
    expect(await widget.evaluate(el => { const tile = el.getBoundingClientRect(); const body = el.querySelector(".hermes-widget")!.getBoundingClientRect(); return body.top >= tile.top && body.bottom <= tile.bottom; })).toBe(true);
  }
});

test("Hermes refresh failure retains metadata, scroll position and geometry before recovery", async ({ page, request }) => {
  let fails = false;
  await page.route("**/api/widget?*", route => route.fulfill({ json: fails ? { ok: false, error: "Hermes unavailable" } : { ok: true, data: DATA } }));
  await page.clock.install({ time: new Date("2026-10-20T12:00:00Z") }); await configure(request); await page.goto("/");
  const list = tile(page).getByRole("list", { name: "Hermes activity" }); await expect(list.getByRole("listitem")).toHaveCount(11);
  await list.focus(); await list.press("End"); await expect.poll(() => list.evaluate(el => el.scrollTop > 0 && Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2)).toBe(true);
  const bounds = await list.boundingBox(); const scroll = await list.evaluate(el => el.scrollTop);
  fails = true; await page.clock.fastForward(30_000); await expect(tile(page).getByRole("alert")).toHaveAccessibleName("Refresh failed; saved data is shown. Hermes unavailable");
  expect(await list.boundingBox()).toEqual(bounds); expect(await list.evaluate(el => el.scrollTop)).toBe(scroll);
  fails = false; await page.clock.fastForward(30_000); await expect(tile(page).getByRole("alert")).toHaveCount(0);
});

test("Hermes shows empty, unsupported and unavailable data explicitly", async ({ page, request }) => {
  await configure(request); await mock(page, { ...DATA, activeApiRuns: 0, nextJob: null, scheduledJobs: 0, failedJobs: 0, sessions: [] }); await page.goto("/");
  await expect(tile(page).getByText("No scheduled jobs")).toBeVisible(); await expect(tile(page).getByText("No recent sessions")).toBeVisible();
  await page.unroute("**/api/widget?*"); await mock(page, { ...DATA, health: "online", activeApiRuns: null, nextJob: null, scheduledJobs: null, failedJobs: null, jobsState: "unsupported", sessionsState: "unavailable", sessions: [] }); await page.reload();
  await expect(tile(page).getByText("API runs: —")).toBeVisible();
  await expect(tile(page).getByText("Scheduled jobs not supported by this Hermes version")).toHaveAttribute("title", "Scheduled jobs not supported by this Hermes version");
  await expect(tile(page).getByText("Recent sessions unavailable")).toBeVisible();
});

test("Hermes uses a separate dashboard launch URL and honors ordinary custom CSS", async ({ page, request }) => {
  await configure(request, [FOOTPRINTS[0]], "dark", ".hermes-widget .widget-list-item { padding: 9px 6px; background: #010203; }"); await mock(page); await page.goto("/");
  await expect(tile(page).getByRole("link", { name: "Hermes · Default", exact: true })).toHaveAttribute("href", "https://hermes.example/dashboard");
  await expect(tile(page).getByRole("listitem").first()).toHaveCSS("background-color", "rgb(1, 2, 3)");
  await expect(tile(page).getByRole("listitem").first()).toHaveCSS("padding-top", "9px");
});

test("Hermes saved integration fetches real metadata server-side without disclosing credentials or private payloads", async ({ request }) => {
  const calls: string[] = [];
  const upstream = createServer((req, res) => {
    calls.push(req.url!);
    if (req.headers.authorization !== "Bearer hermes-test-secret") { res.writeHead(401).end(); return; }
    res.setHeader("Content-Type", "application/json");
    const body = req.url === "/p/home/health/detailed" ? { status: "ok", readiness: { status: "ok" }, api_server: { active_runs: 0 } }
      : req.url?.startsWith("/p/home/api/jobs") ? { jobs: [{ name: "Daily report", enabled: true, next_run_at: "2026-10-21T06:00:00Z", prompt: "private-job-prompt" }] }
        : { data: [{ id: "session", title: "Backups", source: "cli", last_active: 1792494000, preview: "private-session-preview" }] };
    res.end(JSON.stringify(body));
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  try {
    const address = upstream.address() as { port: number };
    await configure(request, [FOOTPRINTS[0]], "dark", undefined, `http://127.0.0.1:${address.port}/p/home`);
    const response = await request.get("/api/widget?tile_id=20000000-0000-4000-8000-000000000000&widget_type=hermes-overview");
    expect(response.ok()).toBe(true); const body = await response.json();
    expect(body).toMatchObject({ ok: true, data: { health: "ready", activeApiRuns: 0, scheduledJobs: 1, sessions: [{ title: "Backups" }] } });
    expect(calls).toHaveLength(3); expect(JSON.stringify(body)).not.toMatch(/private-|hermes-test-secret/);
    const settings = await (await request.get("/api/settings")).text(); expect(settings).not.toContain("hermes-test-secret");
  } finally { await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve())); }
});

test("Hermes editor preset saves a reusable integration and defaults to 3×4", async ({ page, request }) => {
  expect((await request.patch("/api/settings", { data: { services: [], service_tiles: [], groups: [{ name: "Agents" }], bookmarks: [], appearance: { theme: "dark" } } })).ok()).toBe(true);
  await mock(page); await page.goto("/"); await page.getByRole("button", { name: "Edit dashboard" }).click();
  await page.getByRole("button", { name: "Add tile to Agents" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Hermes Overview", exact: true }).click();
  await expect(page.getByLabel("Footprint", { exact: true })).toHaveValue("3x4");
  await expect(page.getByLabel("Footprint", { exact: true }).locator("option")).toHaveCount(2);
  await page.getByLabel("API server URL *", { exact: true }).fill("http://hermes:8642");
  await page.getByLabel("API server key *", { exact: true }).fill("hermes-test-secret");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const saved = page.waitForResponse(r => r.url().endsWith("/api/settings") && r.request().method() === "PATCH");
  await page.getByRole("button", { name: /Save & exit/ }).click(); expect((await saved).ok()).toBe(true);
  const persisted = await (await request.get("/api/settings")).json();
  expect(persisted.services[0].integration.type).toBe("hermes"); expect(JSON.stringify(persisted)).not.toContain("hermes-test-secret");
  expect(persisted.service_tiles[0]).toMatchObject({ footprint: FOOTPRINTS[0], widget: { type: "hermes-overview" } });
  await page.reload(); await expect(tile(page).getByText("Ready", { exact: true })).toBeVisible();
});

test("Hermes dark and light previews show both supported sizes", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1108, height: 640 }); await mock(page);
  for (const theme of ["dark", "light"] as const) {
    await configure(request, FOOTPRINTS, theme); await page.goto("/"); await expect(page.locator(".hermes-widget")).toHaveCount(2);
    await testInfo.attach(`Hermes-${theme}`, { body: await page.locator(".dashboard-tile-grid").screenshot({ path: process.env.KOKPIT_WIDGET_PREVIEW_DIR ? `${process.env.KOKPIT_WIDGET_PREVIEW_DIR}/hermes-${theme}.png` : undefined }), contentType: "image/png" });
  }
});
