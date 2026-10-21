import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

/** Run a saved-widget request in a real tab, optionally abandoning its wait. */
async function fetchTile(page: Page, tileId: string, abort = false) {
  return page.evaluate(async ({ tileId, abort }) => {
    const controller = new AbortController();
    const timer = abort ? setTimeout(() => controller.abort(), 40) : undefined;
    try {
      const response = await fetch(`/api/widget?tile_id=${tileId}`, {
        headers: { "X-Kokpit-E2E-Widget-Probe": "1" },
        signal: controller.signal,
      });
      return { status: response.status, body: await response.json() };
    } catch (error) {
      return controller.signal.aborted ? { aborted: true } : { aborted: false, errorString: String(error) };
    } finally { clearTimeout(timer); }
  }, { tileId, abort });
}

test("equivalent tiles in separate browser contexts share upstream work and survive one tab abort", async ({ browser, request, baseURL }) => {
  let calls = 0;
  const upstream = createServer((incoming, response) => {
    if (new URL(incoming.url ?? "/", "http://localhost").pathname !== "/status/sessions") {
      response.writeHead(404); response.end(); return;
    }
    calls++;
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ MediaContainer: { size: 1, Metadata: [{ title: "Shared stream" }] } }));
    }, 150);
  });
  const serviceId = randomUUID();
  const tileIds: string[] = [randomUUID(), randomUUID()];
  const contexts: BrowserContext[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      upstream.once("error", reject);
      upstream.listen(0, "127.0.0.1", () => {
        upstream.off("error", reject);
        resolve();
      });
    });
    const address = upstream.address();
    if (address === null || typeof address === "string") throw new Error("Missing widget test server address");
    for (let index = 0; index < tileIds.length; index++) {
      contexts.push(await browser.newContext({ baseURL }));
    }
    const initial = await (await request.get("/api/settings")).json();
    expect((await request.patch("/api/settings", { data: {
      services: [...initial.services, { id: serviceId, name: `Cache ${serviceId}`, integration: {
        type: "plex", config: { url: `http://127.0.0.1:${address.port}`, token: "widget-cache-test-token" },
      } }],
      service_tiles: [...initial.service_tiles, ...tileIds.map(id => ({
        id, service_id: serviceId, footprint: { columnSpan: 3, rowSpan: 2 }, widget: { type: "plex", config: { fields: ["streams"] } },
      }))],
    } })).status()).toBe(200);
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    // Keep background polls stubbed throughout; only explicit probes may
    // populate the real cache whose upstream requests are measured below.
    for (const page of pages) {
      await page.route("**/api/widget?**", route => {
        const widgetRequest = route.request();
        if (tileIds.includes(new URL(widgetRequest.url()).searchParams.get("tile_id") ?? "")
          && widgetRequest.headers()["x-kokpit-e2e-widget-probe"] !== "1") {
          return route.fulfill({ json: { ok: true, data: { streams: 0 } } });
        }
        return route.continue();
      });
      await page.goto("/");
      await expect(page.getByRole("navigation")).toBeVisible();
    }
    expect(calls).toBe(0);
    const results = await Promise.all(pages.map((page, index) => fetchTile(page, tileIds[index])));
    for (const result of results) expect(result).toMatchObject({ status: 200, body: { ok: true, data: { streams: 1 } } });
    expect(calls).toBe(1);
    const cached = await fetchTile(pages[1], tileIds[1]);
    expect(cached).toMatchObject({ status: 200, body: { ok: true, data: { streams: 1 } } });
    expect(calls).toBe(1);

    const current = await (await request.get("/api/settings")).json();
    expect((await request.patch("/api/settings", { data: {
      service_tiles: current.service_tiles.map((tile: { id: string }) => tileIds.includes(tile.id)
        ? { ...tile, widget: { type: "plex", config: { fields: ["streams", "transcodes"] } } } : tile),
    } })).status()).toBe(200);
    const [abandoned, remaining] = await Promise.all([
      fetchTile(pages[0], tileIds[0], true), fetchTile(pages[1], tileIds[1]),
    ]);
    expect(abandoned).toEqual({ aborted: true });
    expect(remaining).toMatchObject({ status: 200, body: { ok: true, data: { streams: 1 } } });
    expect(calls).toBe(2);
  } finally {
    try {
      const current = await (await request.get("/api/settings")).json();
      const cleanup = await request.patch("/api/settings", { data: {
        services: current.services.filter((service: { id: string }) => service.id !== serviceId),
        service_tiles: current.service_tiles.filter((tile: { id: string }) => !tileIds.includes(tile.id)),
      } });
      expect(cleanup.status()).toBe(200);
    } finally {
      try {
        await Promise.all(contexts.map(context => context.close()));
      } finally {
        upstream.closeAllConnections();
        await new Promise<void>(resolve => upstream.close(() => resolve()));
      }
    }
  }
});
