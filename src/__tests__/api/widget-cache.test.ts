// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { KokpitConfig } from "@/config/schema";
import type { WidgetDefinition } from "@/widgets";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), snapshot: vi.fn(), widget: vi.fn(), integration: vi.fn(), fetch: vi.fn() }));
vi.mock("@/integrations", () => ({}));
vi.mock("@/auth", () => ({ isRequestAuthenticated: mocks.auth }));
vi.mock("@/config/server", () => ({
  getConfigSnapshot: mocks.snapshot, getPublishedConfigSnapshot: mocks.snapshot,
  legacyIntegrationType: () => "cache-integration",
}));
vi.mock("@/config/revision", () => ({ configRevision: (source: string) => `revision:${source}` }));
vi.mock("@/widgets", () => ({ getWidget: mocks.widget, getIntegration: mocks.integration }));

let config: KokpitConfig;
let definition: WidgetDefinition;
let source: string;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  source = "source-A";
  mocks.auth.mockResolvedValue(true);
  mocks.fetch.mockResolvedValue({ value: 42 });
  config = {
    schema_version: 2,
    services: [{ id: "service", name: "Shared", integration: { type: "cache-integration", config: { url: "https://service.local", api_key: "private-api-key" } } }],
    service_tiles: Array.from({ length: 2 }, (_, index) => ({
      id: `tile-${index}`, service_id: "service", footprint: { columnSpan: 3, rowSpan: 4 },
      widget: { type: "cache-widget", config: { fields: ["one", "two"] } },
    })),
    auth: { enabled: true }, appearance: { theme: "dark" }, layout: {},
  } as KokpitConfig;
  const connectionSchema = z.object({ url: z.string().url(), api_key: z.string().min(1) });
  const optionsSchema = z.object({ fields: z.array(z.string()) });
  definition = {
    id: "cache-widget", name: "Cache widget", integrationType: "cache-integration",
    configSchema: connectionSchema.extend(optionsSchema.shape), optionsSchema,
    fetchData: mocks.fetch, component: () => null, refreshInterval: 30_000,
  };
  mocks.widget.mockImplementation((type: string) => type === "cache-widget" ? definition : undefined);
  mocks.integration.mockReturnValue({ connectionSchema });
  mocks.snapshot.mockImplementation(() => ({ state: "ready", config, source }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function request(tile = "tile-0", init?: RequestInit) {
  return new Request(`http://localhost/api/widget?tile_id=${tile}`, init);
}

describe("saved widget request sharing", () => {
  it("shares different identical tiles, validates callers every time, and sends private/no-store", async () => {
    const pending = deferred<unknown>();
    mocks.fetch.mockReturnValue(pending.promise);
    const { GET } = await import("@/app/api/widget/route");
    const first = GET(request());
    const second = GET(request("tile-1"));
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    pending.resolve({ shared: true });
    for (const response of await Promise.all([first, second, GET(request())])) {
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ ok: true, data: { shared: true } });
    }
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledWith(
      { url: "https://service.local", api_key: "private-api-key" }, { fields: ["one", "two"] }, expect.any(AbortSignal)
    );
    expect(mocks.auth).toHaveBeenCalledTimes(6);
  });

  it.each(["credential", "url", "options", "footprint", "type", "definition"])("does not mix distinct %s inputs", async variation => {
    const { GET } = await import("@/app/api/widget/route");
    expect((await GET(request())).status).toBe(200);
    if (variation === "credential") config.services[0].integration!.config.api_key = "rotated-api-key";
    if (variation === "url") config.services[0].integration!.config.url = "https://different.local";
    if (variation === "options") config.service_tiles[0].widget!.config = { fields: ["two", "one"] };
    if (variation === "footprint") config.service_tiles[0].footprint = { columnSpan: 6, rowSpan: 4 };
    if (variation === "type") {
      config.service_tiles[0].widget!.type = "different-widget";
      mocks.widget.mockReturnValue({ ...definition, id: "different-widget" });
    }
    if (variation === "definition") definition = { ...definition };
    expect((await GET(request())).status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("canonicalizes equivalent config key order without splitting tiles", async () => {
    config.services.push({ ...config.services[0], id: "second-service", integration: {
      type: "cache-integration", config: { api_key: "private-api-key", url: "https://service.local" },
    } });
    config.service_tiles[1].service_id = "second-service";
    const { GET } = await import("@/app/api/widget/route");
    await GET(request());
    await GET(request("tile-1"));
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it("preserves the legacy fetch convention and includes the resolved footprint", async () => {
    delete definition.optionsSchema;
    const { GET } = await import("@/app/api/widget/route");
    expect((await GET(request())).status).toBe(200);
    expect(mocks.fetch).toHaveBeenCalledWith(
      { url: "https://service.local", api_key: "private-api-key", fields: ["one", "two"] },
      expect.any(AbortSignal), { footprint: { columnSpan: 3, rowSpan: 4 } }
    );
  });

  it("applies tile override/widget interval per consumer and caps success age at five seconds", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    definition.refreshInterval = 1_000;
    config.service_tiles[1].widget!.refresh_interval_ms = 5_000;
    const { GET } = await import("@/app/api/widget/route");
    await GET(request("tile-1"));
    now = 999;
    await GET(request());
    expect(mocks.fetch).toHaveBeenCalledOnce();
    now = 1_000;
    await GET(request());
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    now = 5_999;
    await GET(request("tile-1"));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    now = 6_000;
    await GET(request("tile-1"));
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it("does not reuse settled results for a widget with interval zero", async () => {
    definition.refreshInterval = 0;
    const { GET } = await import("@/app/api/widget/route");
    await GET(request());
    await GET(request("tile-1"));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["unauthorized", "deleted", "wrong-type", "invalid"])("cannot bypass %s validation with an existing success", async variation => {
    const { GET } = await import("@/app/api/widget/route");
    await GET(request());
    if (variation === "unauthorized") mocks.auth.mockResolvedValue(false);
    if (variation === "deleted") config.service_tiles = [];
    if (variation === "wrong-type") config.service_tiles[0].widget!.type = "unknown";
    if (variation === "invalid") config.services[0].integration!.config.api_key = "";
    const response = await GET(request());
    expect(response.status).toBe(variation === "unauthorized" ? 401 : variation === "invalid" ? 400 : 404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it.each(["dirty", "revision", "credential", "deleted"])("rejects a delayed result across %s config transitions", async variation => {
    const pending = deferred<unknown>();
    mocks.fetch.mockReturnValue(pending.promise);
    const { GET } = await import("@/app/api/widget/route");
    const response = GET(request());
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    if (variation === "dirty") mocks.snapshot.mockReturnValue({ state: "dirty", config, source });
    else {
      source = "source-B";
      if (variation === "credential") config.services[0].integration!.config.api_key = "replacement-key";
      if (variation === "deleted") config.service_tiles = [];
    }
    pending.resolve({ oldConfiguration: true });
    const result = await response;
    expect(result.status).toBe(409);
    const body = await result.text();
    expect(JSON.parse(body)).toMatchObject({ ok: false, code: "config_unavailable" });
    expect(body).not.toContain("oldConfiguration");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("reauthorizes sessions after upstream completion", async () => {
    const pending = deferred<unknown>();
    mocks.fetch.mockReturnValue(pending.promise);
    const { GET } = await import("@/app/api/widget/route");
    const response = GET(request());
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    mocks.auth.mockResolvedValue(false);
    pending.resolve({ protectedData: true });
    const result = await response;
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ ok: false, error: "Unauthorized" });
  });

  it("rechecks source after awaited final authorization", async () => {
    mocks.auth.mockResolvedValueOnce(true).mockImplementationOnce(async () => { source = "source-B"; return true; });
    const { GET } = await import("@/app/api/widget/route");
    expect((await GET(request())).status).toBe(409);
  });

  it("does not reuse old config if initial authentication yields across a source change", async () => {
    mocks.auth.mockImplementationOnce(async () => { source = "source-B"; return true; });
    const { GET } = await import("@/app/api/widget/route");
    expect((await GET(request())).status).toBe(409);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("detaches an aborted caller while a second tile still receives shared data", async () => {
    const pending = deferred<unknown>();
    mocks.fetch.mockReturnValue(pending.promise);
    const local = new AbortController();
    const { GET } = await import("@/app/api/widget/route");
    const first = GET(request("tile-0", { signal: local.signal }));
    const second = GET(request("tile-1"));
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    local.abort();
    expect((await first).status).toBe(499);
    expect((mocks.fetch.mock.calls[0][2] as AbortSignal).aborted).toBe(false);
    pending.resolve({ shared: true });
    expect(await (await second).json()).toEqual({ ok: true, data: { shared: true } });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("returns sanitized retryable capacity errors while existing identities may join", async () => {
    const pending = deferred<unknown>();
    mocks.fetch.mockReturnValue(pending.promise);
    config.service_tiles = Array.from({ length: 65 }, (_, index) => ({
      ...config.service_tiles[0], id: `tile-${index}`, widget: { type: "cache-widget", config: { fields: [`field-${index}`] } },
    }));
    const { GET } = await import("@/app/api/widget/route");
    const running = Array.from({ length: 64 }, (_, index) => GET(request(`tile-${index}`)));
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(64));
    const full = await GET(request("tile-64"));
    expect(full.status).toBe(503);
    expect(full.headers.get("retry-after")).toBe("1");
    expect(full.headers.get("cache-control")).toBe("private, no-store");
    const body = await full.text();
    expect(JSON.parse(body)).toMatchObject({ code: "widget_busy", retryable: true });
    expect(body).not.toContain("private-api-key");
    const joined = GET(request());
    pending.resolve({ shared: true });
    expect((await Promise.all([...running, joined])).every(response => response.status === 200)).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(64);
    expect(console.error).not.toHaveBeenCalled();
  });
});
