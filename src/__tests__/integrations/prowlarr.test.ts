// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearRegistry } from "@/widgets";
import { fetchStats } from "@/integrations/prowlarr/api";

const BASE_CONFIG = {
  url: "http://prowlarr.local:9696",
  api_key: "abc123secret",
};

const MOCK_INDEXERS = [
  { id: 1, name: "IndexerA", enable: true, protocol: "torrent" },
  { id: 2, name: "IndexerB", enable: false, protocol: "usenet" },
  { id: 3, name: "IndexerC", enable: true, protocol: "torrent" },
];

const MOCK_STATUSES = [{ indexerId: 2 }];

const MOCK_HISTORY = {
  totalRecords: 157,
  records: [],
};

function makeJsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function makeErrorResponse(status: number) {
  return { ok: false, status };
}

// ---------------------------------------------------------------------------
// fetchStats
// ---------------------------------------------------------------------------

describe("fetchStats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("computes correct stats from the 3 parallel endpoints", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(MOCK_INDEXERS))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_STATUSES))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_HISTORY));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchStats(BASE_CONFIG);

    expect(result.totalIndexers).toBe(3);
    expect(result.enabledIndexers).toBe(2);
    expect(result.failingIndexers).toBe(1);
    expect(result.totalGrabs).toBe(157);
  });

  it("fetches indexer, indexerstatus, and history endpoints", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(MOCK_INDEXERS))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_STATUSES))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_HISTORY));
    vi.stubGlobal("fetch", mockFetch);

    await fetchStats(BASE_CONFIG);

    const urls = mockFetch.mock.calls.map(([url]) => url as string);
    expect(urls.some((u) => u.includes("api/v1/indexer") && !u.includes("indexerstatus"))).toBe(
      true
    );
    expect(urls.some((u) => u.includes("api/v1/indexerstatus"))).toBe(true);
    expect(
      urls.some(
        (u) =>
          u.includes("api/v1/history") &&
          u.includes("pageSize=1") &&
          u.includes("sortKey=date") &&
          u.includes("sortDirection=descending")
      )
    ).toBe(true);
  });

  it("sends the X-Api-Key header on all 3 calls", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(MOCK_INDEXERS))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_STATUSES))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_HISTORY));
    vi.stubGlobal("fetch", mockFetch);

    await fetchStats(BASE_CONFIG);

    for (const [, options] of mockFetch.mock.calls) {
      expect(options.headers["X-Api-Key"]).toBe("abc123secret");
    }
  });

  it("throws when the indexer endpoint is non-ok", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeErrorResponse(401))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_STATUSES))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_HISTORY));
    vi.stubGlobal("fetch", mockFetch);

    await expect(fetchStats(BASE_CONFIG)).rejects.toThrow("Prowlarr responded with 401");
  });

  it("throws when the indexerstatus endpoint is non-ok", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(MOCK_INDEXERS))
      .mockResolvedValueOnce(makeErrorResponse(500))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_HISTORY));
    vi.stubGlobal("fetch", mockFetch);

    await expect(fetchStats(BASE_CONFIG)).rejects.toThrow("Prowlarr responded with 500");
  });

  it("throws when the history endpoint is non-ok", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(MOCK_INDEXERS))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_STATUSES))
      .mockResolvedValueOnce(makeErrorResponse(503));
    vi.stubGlobal("fetch", mockFetch);

    await expect(fetchStats(BASE_CONFIG)).rejects.toThrow("Prowlarr responded with 503");
  });

  it("throws a zod validation error on malformed indexer JSON", async () => {
    const malformedIndexers = [{ id: 1, name: "IndexerA" }]; // missing enable/protocol
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(malformedIndexers))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_STATUSES))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_HISTORY));
    vi.stubGlobal("fetch", mockFetch);

    await expect(fetchStats(BASE_CONFIG)).rejects.toThrow();
  });

  it("throws a zod validation error on malformed history JSON", async () => {
    const malformedHistory = { records: [] }; // missing totalRecords
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(MOCK_INDEXERS))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_STATUSES))
      .mockResolvedValueOnce(makeJsonResponse(malformedHistory));
    vi.stubGlobal("fetch", mockFetch);

    await expect(fetchStats(BASE_CONFIG)).rejects.toThrow();
  });

  it("forwards AbortSignal to all 3 calls", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(MOCK_INDEXERS))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_STATUSES))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_HISTORY));
    vi.stubGlobal("fetch", mockFetch);

    const controller = new AbortController();
    await fetchStats(BASE_CONFIG, controller.signal);

    for (const [, options] of mockFetch.mock.calls) {
      expect(options.signal).toBe(controller.signal);
    }
  });

  it("handles zero failing indexers and zero grabs", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(MOCK_INDEXERS))
      .mockResolvedValueOnce(makeJsonResponse([]))
      .mockResolvedValueOnce(makeJsonResponse({ totalRecords: 0, records: [] }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchStats(BASE_CONFIG);

    expect(result.failingIndexers).toBe(0);
    expect(result.totalGrabs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Widget registration
// ---------------------------------------------------------------------------

describe("prowlarr-stats widget registration", () => {
  beforeEach(() => {
    clearRegistry();
    vi.resetModules();
  });

  it("registers a widget with id 'prowlarr-stats' on import", async () => {
    await import("@/integrations/prowlarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("prowlarr-stats")).toBeDefined();
  });

  it("widget name is 'Prowlarr Stats'", async () => {
    await import("@/integrations/prowlarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("prowlarr-stats")?.name).toBe("Prowlarr Stats");
  });

  it("refreshInterval is 60000", async () => {
    await import("@/integrations/prowlarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("prowlarr-stats")?.refreshInterval).toBe(60_000);
  });

  it("configSchema accepts valid config", async () => {
    await import("@/integrations/prowlarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("prowlarr-stats")!.configSchema.safeParse({
      url: "http://192.168.1.10:9696",
      api_key: "myapikey",
    });
    expect(result.success).toBe(true);
  });

  it("configSchema rejects invalid URL", async () => {
    await import("@/integrations/prowlarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("prowlarr-stats")!.configSchema.safeParse({
      url: "not-a-url",
      api_key: "myapikey",
    });
    expect(result.success).toBe(false);
  });

  it("configSchema rejects empty api_key", async () => {
    await import("@/integrations/prowlarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("prowlarr-stats")!.configSchema.safeParse({
      url: "http://192.168.1.10:9696",
      api_key: "",
    });
    expect(result.success).toBe(false);
  });

  it("configSchema rejects missing url or api_key", async () => {
    await import("@/integrations/prowlarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("prowlarr-stats")!.configSchema.safeParse({
      url: "http://192.168.1.10:9696",
    });
    expect(result.success).toBe(false);
  });

  it("configFields contains url and api_key keys", async () => {
    await import("@/integrations/prowlarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    const fields = getWidget("prowlarr-stats")?.configFields ?? [];
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("url");
    expect(keys).toContain("api_key");
  });
});
