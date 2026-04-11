// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearRegistry } from "@/widgets";
import { fetchStats, fetchRequests } from "@/integrations/seerr/api";

const BASE_CONFIG = {
  url: "http://seerr.local:5055",
  api_key: "abc123secret",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeJsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function makeErrorResponse(status: number) {
  return { ok: false, status };
}

function makePageInfoResponse(results: number) {
  return makeJsonResponse({ pageInfo: { results } });
}

// ── fetchStats ────────────────────────────────────────────────────────────────

describe("fetchStats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns correct counts from pageInfo.results across 4 responses", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makePageInfoResponse(42)) // all
      .mockResolvedValueOnce(makePageInfoResponse(5))  // pending
      .mockResolvedValueOnce(makePageInfoResponse(20)) // approved
      .mockResolvedValueOnce(makePageInfoResponse(17)); // available
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchStats(BASE_CONFIG);

    expect(result.total).toBe(42);
    expect(result.pending).toBe(5);
    expect(result.approved).toBe(20);
    expect(result.available).toBe(17);
  });

  it("makes exactly 4 fetch calls", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makePageInfoResponse(0));
    vi.stubGlobal("fetch", mockFetch);

    await fetchStats(BASE_CONFIG);

    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("all 4 calls use the X-Api-Key header", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makePageInfoResponse(0));
    vi.stubGlobal("fetch", mockFetch);

    await fetchStats(BASE_CONFIG);

    for (const [, options] of mockFetch.mock.calls) {
      expect(options.headers["X-Api-Key"]).toBe("abc123secret");
    }
  });

  it("calls include filter=all, filter=pending, filter=approved, filter=available", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makePageInfoResponse(0));
    vi.stubGlobal("fetch", mockFetch);

    await fetchStats(BASE_CONFIG);

    const urls = mockFetch.mock.calls.map(([url]) => url);
    expect(urls.some((u: string) => u.includes("filter=all"))).toBe(true);
    expect(urls.some((u: string) => u.includes("filter=pending"))).toBe(true);
    expect(urls.some((u: string) => u.includes("filter=approved"))).toBe(true);
    expect(urls.some((u: string) => u.includes("filter=available"))).toBe(true);
  });

  it("all calls include take=1", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makePageInfoResponse(0));
    vi.stubGlobal("fetch", mockFetch);

    await fetchStats(BASE_CONFIG);

    for (const [url] of mockFetch.mock.calls) {
      expect(url).toContain("take=1");
    }
  });

  it("throws on non-2xx response with status in message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeErrorResponse(401)));
    await expect(fetchStats(BASE_CONFIG)).rejects.toThrow("401");
  });

  it("forwards AbortSignal to all calls", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makePageInfoResponse(0));
    vi.stubGlobal("fetch", mockFetch);

    const controller = new AbortController();
    await fetchStats(BASE_CONFIG, controller.signal);

    for (const [, options] of mockFetch.mock.calls) {
      expect(options.signal).toBe(controller.signal);
    }
  });

  it("preserves base path in config.url when resolving API path", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makePageInfoResponse(0));
    vi.stubGlobal("fetch", mockFetch);

    const configWithBasePath = { ...BASE_CONFIG, url: "http://seerr.local:5055/seerr/" };
    await fetchStats(configWithBasePath);

    const urls = mockFetch.mock.calls.map(([url]) => url);
    for (const url of urls) {
      expect(url).toContain("/seerr/api/v1/request");
    }
  });
});

// ── fetchRequests ─────────────────────────────────────────────────────────────

const MOCK_MOVIE_REQUEST = {
  id: 1,
  status: 1,
  createdAt: "2026-02-01T10:00:00.000Z",
  type: "movie",
  requestedBy: { displayName: "Alice" },
  media: { tmdbId: 550, status: 2, title: "Fight Club", name: null },
};

const MOCK_TV_REQUEST = {
  id: 2,
  status: 2,
  createdAt: "2026-02-02T12:00:00.000Z",
  type: "tv",
  requestedBy: { displayName: "Bob" },
  media: { tmdbId: 1396, status: 5, title: null, name: "Breaking Bad" },
};

const MOCK_NO_TITLE_REQUEST = {
  id: 3,
  status: 1,
  createdAt: "2026-02-03T08:00:00.000Z",
  type: "movie",
  requestedBy: { displayName: "Carol" },
  media: { tmdbId: 999, status: 1, title: null, name: null },
};

describe("fetchRequests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns parsed request array from results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeJsonResponse({ results: [MOCK_MOVIE_REQUEST, MOCK_TV_REQUEST] }))
    );
    const result = await fetchRequests(BASE_CONFIG);
    expect(result).toHaveLength(2);
  });

  it("extracts media.title for movies into title field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeJsonResponse({ results: [MOCK_MOVIE_REQUEST] }))
    );
    const result = await fetchRequests(BASE_CONFIG);
    expect(result[0].title).toBe("Fight Club");
  });

  it("falls back to media.name when media.title is absent (TV shows)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeJsonResponse({ results: [MOCK_TV_REQUEST] }))
    );
    const result = await fetchRequests(BASE_CONFIG);
    expect(result[0].title).toBe("Breaking Bad");
  });

  it("sets title to null when neither title nor name is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeJsonResponse({ results: [MOCK_NO_TITLE_REQUEST] }))
    );
    const result = await fetchRequests(BASE_CONFIG);
    expect(result[0].title).toBeNull();
  });

  it("preserves requestStatus and mediaStatus correctly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeJsonResponse({ results: [MOCK_TV_REQUEST] }))
    );
    const result = await fetchRequests(BASE_CONFIG);
    expect(result[0].requestStatus).toBe(2);
    expect(result[0].mediaStatus).toBe(5);
  });

  it("preserves mediaType, tmdbId, requestedBy, and createdAt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeJsonResponse({ results: [MOCK_MOVIE_REQUEST] }))
    );
    const result = await fetchRequests(BASE_CONFIG);
    expect(result[0].mediaType).toBe("movie");
    expect(result[0].tmdbId).toBe(550);
    expect(result[0].requestedBy).toBe("Alice");
    expect(result[0].createdAt).toBe("2026-02-01T10:00:00.000Z");
  });

  it("sends endpoint with take=15, sort=added, filter=all", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeJsonResponse({ results: [] }));
    vi.stubGlobal("fetch", mockFetch);

    await fetchRequests(BASE_CONFIG);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("take=15");
    expect(url).toContain("sort=added");
    expect(url).toContain("filter=all");
  });

  it("sends X-Api-Key header", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeJsonResponse({ results: [] }));
    vi.stubGlobal("fetch", mockFetch);

    await fetchRequests(BASE_CONFIG);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers["X-Api-Key"]).toBe("abc123secret");
  });

  it("throws on non-2xx response with status in message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeErrorResponse(403)));
    await expect(fetchRequests(BASE_CONFIG)).rejects.toThrow("403");
  });

  it("forwards AbortSignal", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(makeJsonResponse({ results: [] }));
    vi.stubGlobal("fetch", mockFetch);

    const controller = new AbortController();
    await fetchRequests(BASE_CONFIG, controller.signal);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.signal).toBe(controller.signal);
  });

  it("strips unknown fields silently via Zod", async () => {
    const withExtra = { ...MOCK_MOVIE_REQUEST, unknownField: "foo" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeJsonResponse({ results: [withExtra] }))
    );
    const result = await fetchRequests(BASE_CONFIG);
    expect(result[0]).not.toHaveProperty("unknownField");
  });

  it("handles empty results gracefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeJsonResponse({ results: [] }))
    );
    const result = await fetchRequests(BASE_CONFIG);
    expect(result).toEqual([]);
  });
});

// ── Widget registration — seerr-stats ─────────────────────────────────────────

describe("seerr-stats widget registration", () => {
  beforeEach(() => {
    clearRegistry();
    vi.resetModules();
  });

  it("registers a widget with id 'seerr-stats' on import", async () => {
    await import("@/integrations/seerr/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("seerr-stats")).toBeDefined();
  });

  it("widget name is 'Seerr Stats'", async () => {
    await import("@/integrations/seerr/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("seerr-stats")?.name).toBe("Seerr Stats");
  });

  it("refreshInterval is 60000", async () => {
    await import("@/integrations/seerr/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("seerr-stats")?.refreshInterval).toBe(60_000);
  });

  it("configSchema accepts valid config", async () => {
    await import("@/integrations/seerr/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("seerr-stats")!.configSchema.safeParse({
      url: "http://192.168.1.10:5055",
      api_key: "myapikey",
    });
    expect(result.success).toBe(true);
  });

  it("configSchema rejects invalid URL", async () => {
    await import("@/integrations/seerr/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("seerr-stats")!.configSchema.safeParse({
      url: "not-a-url",
      api_key: "myapikey",
    });
    expect(result.success).toBe(false);
  });

  it("configSchema rejects empty api_key", async () => {
    await import("@/integrations/seerr/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("seerr-stats")!.configSchema.safeParse({
      url: "http://192.168.1.10:5055",
      api_key: "",
    });
    expect(result.success).toBe(false);
  });

  it("configFields contains url and api_key keys", async () => {
    await import("@/integrations/seerr/statsWidget");
    const { getWidget } = await import("@/widgets");
    const fields = getWidget("seerr-stats")?.configFields ?? [];
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("url");
    expect(keys).toContain("api_key");
  });
});

// ── Widget registration — seerr-requests ─────────────────────────────────────

describe("seerr-requests widget registration", () => {
  beforeEach(() => {
    clearRegistry();
    vi.resetModules();
  });

  it("registers a widget with id 'seerr-requests' on import", async () => {
    await import("@/integrations/seerr/requestsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("seerr-requests")).toBeDefined();
  });

  it("widget name is 'Seerr Requests'", async () => {
    await import("@/integrations/seerr/requestsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("seerr-requests")?.name).toBe("Seerr Requests");
  });

  it("refreshInterval is 60000", async () => {
    await import("@/integrations/seerr/requestsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("seerr-requests")?.refreshInterval).toBe(60_000);
  });

  it("configSchema accepts valid config", async () => {
    await import("@/integrations/seerr/requestsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("seerr-requests")!.configSchema.safeParse({
      url: "http://192.168.1.10:5055",
      api_key: "myapikey",
    });
    expect(result.success).toBe(true);
  });

  it("configSchema rejects invalid URL", async () => {
    await import("@/integrations/seerr/requestsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("seerr-requests")!.configSchema.safeParse({
      url: "not-a-url",
      api_key: "myapikey",
    });
    expect(result.success).toBe(false);
  });

  it("configSchema rejects empty api_key", async () => {
    await import("@/integrations/seerr/requestsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("seerr-requests")!.configSchema.safeParse({
      url: "http://192.168.1.10:5055",
      api_key: "",
    });
    expect(result.success).toBe(false);
  });

  it("configFields contains url and api_key keys", async () => {
    await import("@/integrations/seerr/requestsWidget");
    const { getWidget } = await import("@/widgets");
    const fields = getWidget("seerr-requests")?.configFields ?? [];
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("url");
    expect(keys).toContain("api_key");
  });
});
