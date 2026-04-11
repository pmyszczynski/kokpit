// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearRegistry } from "@/widgets";
import { fetchStats } from "@/integrations/immich/api";

const BASE_CONFIG = {
  url: "http://immich.local:2283/api",
  api_key: "immichapikey",
};

const MOCK_STATS_RESPONSE = {
  photos: 1200,
  videos: 340,
  usage: 9876543210,
  usagePhotos: 5678901234,
  usageVideos: 4197641976,
};

function makeJsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function makeErrorResponse(status: number) {
  return { ok: false, status };
}

describe("fetchStats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns parsed Immich stats from /server/statistics", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse(MOCK_STATS_RESPONSE)));

    const result = await fetchStats(BASE_CONFIG);

    expect(result).toEqual(MOCK_STATS_RESPONSE);
  });

  it("calls the server/statistics endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_STATS_RESPONSE));
    vi.stubGlobal("fetch", mockFetch);

    await fetchStats(BASE_CONFIG);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/server/statistics");
  });

  it("preserves base path in config.url when resolving API path", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_STATS_RESPONSE));
    vi.stubGlobal("fetch", mockFetch);

    await fetchStats({
      ...BASE_CONFIG,
      url: "http://immich.local:2283/immich/api/",
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/immich/api/server/statistics");
  });

  it("adds /api when config.url does not include it", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_STATS_RESPONSE));
    vi.stubGlobal("fetch", mockFetch);

    await fetchStats({
      ...BASE_CONFIG,
      url: "http://immich.local:2283",
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/server/statistics");
  });

  it("uses X-Api-Key header", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_STATS_RESPONSE));
    vi.stubGlobal("fetch", mockFetch);

    await fetchStats(BASE_CONFIG);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers["X-Api-Key"]).toBe("immichapikey");
  });

  it("throws on non-2xx response with status in message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeErrorResponse(401)));

    await expect(fetchStats(BASE_CONFIG)).rejects.toThrow("401");
  });

  it("forwards AbortSignal", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_STATS_RESPONSE));
    vi.stubGlobal("fetch", mockFetch);

    const controller = new AbortController();
    await fetchStats(BASE_CONFIG, controller.signal);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.signal).toBe(controller.signal);
  });
});

describe("immich-stats widget registration", () => {
  beforeEach(() => {
    clearRegistry();
    vi.resetModules();
  });

  it("registers a widget with id 'immich-stats' on import", async () => {
    await import("@/integrations/immich/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("immich-stats")).toBeDefined();
  });

  it("widget name is 'Immich Stats'", async () => {
    await import("@/integrations/immich/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("immich-stats")?.name).toBe("Immich Stats");
  });

  it("refreshInterval is 60000", async () => {
    await import("@/integrations/immich/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("immich-stats")?.refreshInterval).toBe(60_000);
  });

  it("configSchema accepts valid config", async () => {
    await import("@/integrations/immich/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("immich-stats")!.configSchema.safeParse({
      url: "http://192.168.1.10:2283/api",
      api_key: "myapikey",
    });
    expect(result.success).toBe(true);
  });

  it("configSchema rejects invalid URL", async () => {
    await import("@/integrations/immich/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("immich-stats")!.configSchema.safeParse({
      url: "not-a-url",
      api_key: "myapikey",
    });
    expect(result.success).toBe(false);
  });

  it("configSchema rejects empty api_key", async () => {
    await import("@/integrations/immich/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("immich-stats")!.configSchema.safeParse({
      url: "http://192.168.1.10:2283/api",
      api_key: "",
    });
    expect(result.success).toBe(false);
  });

  it("configFields contains url and api_key keys", async () => {
    await import("@/integrations/immich/statsWidget");
    const { getWidget } = await import("@/widgets");
    const fields = getWidget("immich-stats")?.configFields ?? [];
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("url");
    expect(keys).toContain("api_key");
  });
});
