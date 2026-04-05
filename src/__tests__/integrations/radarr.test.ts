// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearRegistry } from "@/widgets";
import { fetchStats, fetchQueue } from "@/integrations/radarr/api";

const BASE_CONFIG = {
  url: "http://radarr.local:7878",
  api_key: "abc123secret",
};

// Mock movie data matching Radarr MovieResource shape.
const MOCK_MOVIES = [
  // downloaded + monitored (available)
  { id: 1, hasFile: true, monitored: true, isAvailable: true, status: "released" },
  // downloaded + monitored (available)
  { id: 2, hasFile: true, monitored: true, isAvailable: true, status: "released" },
  // missing: monitored, no file, isAvailable
  { id: 3, hasFile: false, monitored: true, isAvailable: true, status: "released" },
  // wanted but not yet available: monitored, no file, not isAvailable
  { id: 4, hasFile: false, monitored: true, isAvailable: false, status: "announced" },
  // upcoming (inCinemas)
  { id: 5, hasFile: false, monitored: true, isAvailable: false, status: "inCinemas" },
  // unmonitored
  { id: 6, hasFile: false, monitored: false, isAvailable: true, status: "released" },
];

const MOCK_QUEUE_TOTAL_RESPONSE = {
  records: [],
  totalRecords: 3,
};

// Mock queue records for fetchQueue tests.
const MOCK_QUEUE_RESPONSE = {
  records: [
    {
      id: 101,
      title: "The.Dark.Knight.2008",
      movie: { title: "The Dark Knight" },
      status: "downloading",
      timeleft: "00:12:34",
      size: 1_000_000_000,
      sizeleft: 300_000_000,
      trackedDownloadStatus: "ok",
    },
    {
      id: 102,
      title: "Inception.2010",
      movie: { title: "Inception" },
      status: "queued",
      size: 900_000_000,
      sizeleft: 900_000_000,
      trackedDownloadStatus: "warning",
    },
  ],
  totalRecords: 2,
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

// ---------------------------------------------------------------------------
// fetchStats
// ---------------------------------------------------------------------------

describe("fetchStats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns correct stat counts", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(MOCK_MOVIES))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_QUEUE_TOTAL_RESPONSE));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchStats(BASE_CONFIG);

    expect(result.total).toBe(6);
    expect(result.available).toBe(2); // hasFile=true
    expect(result.missing).toBe(1);   // monitored && !hasFile && isAvailable (id:3)
    expect(result.wanted).toBe(3);    // monitored && !hasFile (id:3,4,5)
    expect(result.upcoming).toBe(2);  // status "announced" or "inCinemas" (id:4,5)
    expect(result.queued).toBe(3);    // from totalRecords
  });

  it("sends X-Api-Key header to both endpoints", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(MOCK_MOVIES))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_QUEUE_TOTAL_RESPONSE));
    vi.stubGlobal("fetch", mockFetch);

    await fetchStats(BASE_CONFIG);

    for (const call of mockFetch.mock.calls) {
      const [, options] = call;
      expect(options.headers["X-Api-Key"]).toBe("abc123secret");
      expect(options.headers.Cookie).toBeUndefined();
    }
  });

  it("fetches /api/v3/movie and /api/v3/queue", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(MOCK_MOVIES))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_QUEUE_TOTAL_RESPONSE));
    vi.stubGlobal("fetch", mockFetch);

    await fetchStats(BASE_CONFIG);

    const urls = mockFetch.mock.calls.map((call) => call[0] as string);
    expect(urls.some((u) => u.includes("/api/v3/movie"))).toBe(true);
    expect(urls.some((u) => u.includes("/api/v3/queue"))).toBe(true);
  });

  it("throws on non-2xx response with status in message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeErrorResponse(401))
    );
    await expect(fetchStats(BASE_CONFIG)).rejects.toThrow("401");
  });

  it("forwards AbortSignal", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(MOCK_MOVIES))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_QUEUE_TOTAL_RESPONSE));
    vi.stubGlobal("fetch", mockFetch);

    const controller = new AbortController();
    await fetchStats(BASE_CONFIG, controller.signal);

    for (const call of mockFetch.mock.calls) {
      const [, options] = call;
      expect(options.signal).toBe(controller.signal);
    }
  });

  it("handles empty movie list", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse([]))
      .mockResolvedValueOnce(makeJsonResponse({ records: [], totalRecords: 0 }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchStats(BASE_CONFIG);

    expect(result.total).toBe(0);
    expect(result.available).toBe(0);
    expect(result.missing).toBe(0);
    expect(result.wanted).toBe(0);
    expect(result.upcoming).toBe(0);
    expect(result.queued).toBe(0);
  });

  it("preserves base path in config.url when resolving API paths", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(MOCK_MOVIES))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_QUEUE_TOTAL_RESPONSE));
    vi.stubGlobal("fetch", mockFetch);

    const configWithBasePath = { ...BASE_CONFIG, url: "http://radarr.local:7878/radarr/" };
    await fetchStats(configWithBasePath);

    const urls = mockFetch.mock.calls.map((call) => call[0] as string);
    expect(urls.some((u) => u.includes("/radarr/api/v3/movie"))).toBe(true);
    expect(urls.every((u) => !u.match(/^http:\/\/radarr\.local:7878\/api\//))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fetchQueue
// ---------------------------------------------------------------------------

describe("fetchQueue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns the records array from wrapped response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse(MOCK_QUEUE_RESPONSE)));
    const result = await fetchQueue(BASE_CONFIG);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(101);
  });

  it("flattens movie.title to movieTitle", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse(MOCK_QUEUE_RESPONSE)));
    const result = await fetchQueue(BASE_CONFIG);
    expect(result[0].movieTitle).toBe("The Dark Knight");
    expect(result[0]).not.toHaveProperty("movie");
  });

  it("sends correct path with query params", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_QUEUE_RESPONSE));
    vi.stubGlobal("fetch", mockFetch);

    await fetchQueue(BASE_CONFIG);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v3/queue");
    expect(url).toContain("pageSize=25");
    expect(url).toContain("includeMovie=true");
    expect(url).toContain("includeUnknownMovieItems=false");
  });

  it("sends X-Api-Key header", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_QUEUE_RESPONSE));
    vi.stubGlobal("fetch", mockFetch);

    await fetchQueue(BASE_CONFIG);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers["X-Api-Key"]).toBe("abc123secret");
  });

  it("handles empty records gracefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeJsonResponse({ records: [], totalRecords: 0 }))
    );
    const result = await fetchQueue(BASE_CONFIG);
    expect(result).toEqual([]);
  });

  it("throws on non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeErrorResponse(500)));
    await expect(fetchQueue(BASE_CONFIG)).rejects.toThrow("500");
  });

  it("timeleft field is optional", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse(MOCK_QUEUE_RESPONSE)));
    const result = await fetchQueue(BASE_CONFIG);
    // item[0] has timeleft, item[1] does not
    expect(result[0].timeleft).toBe("00:12:34");
    expect(result[1].timeleft).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Widget registration — radarr-stats
// ---------------------------------------------------------------------------

describe("radarr-stats widget registration", () => {
  beforeEach(() => {
    clearRegistry();
    vi.resetModules();
  });

  it("registers a widget with id 'radarr-stats' on import", async () => {
    await import("@/integrations/radarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("radarr-stats")).toBeDefined();
  });

  it("widget name is 'Radarr Stats'", async () => {
    await import("@/integrations/radarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("radarr-stats")?.name).toBe("Radarr Stats");
  });

  it("refreshInterval is 60000", async () => {
    await import("@/integrations/radarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("radarr-stats")?.refreshInterval).toBe(60_000);
  });

  it("configSchema accepts valid config", async () => {
    await import("@/integrations/radarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("radarr-stats")!.configSchema.safeParse({
      url: "http://192.168.1.10:7878",
      api_key: "myapikey",
    });
    expect(result.success).toBe(true);
  });

  it("configSchema rejects invalid URL", async () => {
    await import("@/integrations/radarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("radarr-stats")!.configSchema.safeParse({
      url: "not-a-url",
      api_key: "myapikey",
    });
    expect(result.success).toBe(false);
  });

  it("configSchema rejects empty api_key", async () => {
    await import("@/integrations/radarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("radarr-stats")!.configSchema.safeParse({
      url: "http://192.168.1.10:7878",
      api_key: "",
    });
    expect(result.success).toBe(false);
  });

  it("configFields contains url and api_key", async () => {
    await import("@/integrations/radarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    const fields = getWidget("radarr-stats")?.configFields ?? [];
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("url");
    expect(keys).toContain("api_key");
  });
});

// ---------------------------------------------------------------------------
// Widget registration — radarr-queue
// ---------------------------------------------------------------------------

describe("radarr-queue widget registration", () => {
  beforeEach(() => {
    clearRegistry();
    vi.resetModules();
  });

  it("registers a widget with id 'radarr-queue' on import", async () => {
    await import("@/integrations/radarr/queueWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("radarr-queue")).toBeDefined();
  });

  it("widget name is 'Radarr Queue'", async () => {
    await import("@/integrations/radarr/queueWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("radarr-queue")?.name).toBe("Radarr Queue");
  });

  it("refreshInterval is 15000", async () => {
    await import("@/integrations/radarr/queueWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("radarr-queue")?.refreshInterval).toBe(15_000);
  });

  it("configSchema accepts valid config", async () => {
    await import("@/integrations/radarr/queueWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("radarr-queue")!.configSchema.safeParse({
      url: "http://192.168.1.10:7878",
      api_key: "myapikey",
    });
    expect(result.success).toBe(true);
  });

  it("configFields contains url and api_key", async () => {
    await import("@/integrations/radarr/queueWidget");
    const { getWidget } = await import("@/widgets");
    const fields = getWidget("radarr-queue")?.configFields ?? [];
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("url");
    expect(keys).toContain("api_key");
  });
});
