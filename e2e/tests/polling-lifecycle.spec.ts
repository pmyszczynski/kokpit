import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

async function configure(request: APIRequestContext, interval?: number) {
  const response = await request.patch("/api/settings", { data: {
    services: [{ id: "10000000-0000-4000-8000-000000000001", name: "Polling lifecycle", launch_url: "https://example.com", icon: "/icons/search.svg" }],
    service_tiles: [{ id: "20000000-0000-4000-8000-000000000001", service_id: "10000000-0000-4000-8000-000000000001", footprint: { columnSpan: 6, rowSpan: 2 },
      widget: { type: "search", config: {}, ...(interval ? { refresh_interval_ms: interval } : {}) } }],
    groups: [], bookmarks: [],
  } });
  expect(response.ok()).toBe(true);
}

async function installVisibilityControl(page: Page) {
  await page.addInitScript(() => {
    let visible = true;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visible ? "visible" : "hidden" });
    Object.defineProperty(window, "setPollingTestVisibility", { value: (value: boolean) => {
      visible = value;
      document.dispatchEvent(new Event("visibilitychange"));
    } });
  });
}

async function setVisible(page: Page, visible: boolean) {
  await page.evaluate(value => {
    (window as typeof window & { setPollingTestVisibility(value: boolean): void }).setPollingTestVisibility(value);
  }, visible);
}

test("hidden and offline dashboards retain data, pause requests and recover once without focus storms", async ({ page, context, request }) => {
  await configure(request, 5000);
  await installVisibilityControl(page);
  await page.clock.install();
  let widgetRequests = 0;
  let pingRequests = 0;
  await page.route("**/api/widget?*", route => {
    widgetRequests++;
    return route.fulfill({ json: { ok: true, data: { action: "https://duckduckgo.com/", queryParameter: "q", parameters: [], engineName: `Engine ${widgetRequests}`, newTab: true } } });
  });
  await page.route("**/api/ping", route => { pingRequests++; return route.fulfill({ json: { ok: true, status: 200 } }); });
  await page.goto("/");
  const tile = page.locator(".service-tile").filter({ hasText: "Polling lifecycle" });
  await expect(tile.getByRole("searchbox")).toBeVisible();
  await expect(tile.locator(".status-dot")).toHaveAttribute("title", "Online");
  const initial = { widget: widgetRequests, ping: pingRequests };
  await setVisible(page, false);
  await page.clock.runFor(60_000);
  expect({ widget: widgetRequests, ping: pingRequests }).toEqual(initial);
  // IMP-11 masks protected content until resume reauthorization, while the
  // mounted widget retains its last successful data throughout the pause.
  await expect(page.locator(".protected-surface")).toBeHidden();
  await expect(page.locator(".protected-surface")).toHaveAttribute("inert", "");
  await expect(tile.getByRole("searchbox", { includeHidden: true })).toBeAttached();
  await expect(tile.locator(".status-dot")).toHaveAttribute("title", "Online");

  await context.setOffline(true);
  await setVisible(page, true);
  await page.clock.runFor(60_000);
  expect({ widget: widgetRequests, ping: pingRequests }).toEqual(initial);
  await context.setOffline(false);
  await expect.poll(() => widgetRequests).toBe(initial.widget + 1);
  await expect.poll(() => pingRequests).toBe(initial.ping + 1);
  await expect(tile.getByText(`Engine ${widgetRequests} · Opens in a new tab`, { exact: true })).toBeVisible();
  await page.evaluate(() => {
    for (let index = 0; index < 20; index++) {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });
  await page.clock.runFor(0);
  expect({ widget: widgetRequests, ping: pingRequests }).toEqual({ widget: initial.widget + 1, ping: initial.ping + 1 });
});

test("interval-zero widgets do not start background polling after reconnect or focus", async ({ page, context, request }) => {
  await configure(request);
  await installVisibilityControl(page);
  await page.clock.install();
  let widgetRequests = 0;
  await page.route("**/api/widget?*", route => {
    widgetRequests++;
    return route.fulfill({ json: { ok: true, data: { action: "https://duckduckgo.com/", queryParameter: "q", parameters: [], engineName: "Saved engine", newTab: true } } });
  });
  await page.route("**/api/ping", route => route.fulfill({ json: { ok: true, status: 200 } }));
  await page.goto("/");
  await expect(page.getByRole("searchbox")).toBeVisible();
  const initial = widgetRequests;
  await setVisible(page, false);
  await context.setOffline(true);
  await page.clock.runFor(60_000);
  await setVisible(page, true);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.clock.runFor(60_000);
  expect(widgetRequests).toBe(initial);
  await expect(page.getByRole("searchbox")).toBeVisible();
});
