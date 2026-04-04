// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearRegistry } from "@/widgets";
import { fetchCalendar, fetchQueue } from "@/integrations/sonarr/api";

const BASE_CONFIG = {
  url: "http://sonarr.local:8989",
  api_key: "abc123secret",
  days: 7,
};

// Mock data matches the actual Sonarr EpisodeResource shape:
// series is a nested object with title, not a flat seriesTitle field.
const MOCK_EPISODES = [
  {
    id: 1,
    title: "Pilot",
    series: { title: "Breaking Bad" },
    airDateUtc: "2026-04-05T02:00:00Z",
    seasonNumber: 1,
    episodeNumber: 1,
    hasFile: true,
    monitored: true,
  },
  {
    id: 2,
    title: "Cat's in the Bag",
    series: { title: "Breaking Bad" },
    airDateUtc: "2026-04-06T02:00:00Z",
    seasonNumber: 1,
    episodeNumber: 2,
    hasFile: false,
    monitored: true,
  },
];

// Mock data matches the actual Sonarr QueueResource shape.
const MOCK_QUEUE_RESPONSE = {
  records: [
    {
      id: 101,
      title: "Breaking.Bad.S01E01",
      series: { title: "Breaking Bad" },
      status: "downloading",
      timeleft: "00:12:34",
      size: 1_000_000_000,
      sizeleft: 300_000_000,
      trackedDownloadStatus: "ok",
    },
    {
      id: 102,
      title: "Breaking.Bad.S01E02",
      series: { title: "Breaking Bad" },
      status: "queued",
      size: 900_000_000,
      sizeleft: 900_000_000,
      trackedDownloadStatus: "warning",
    },
  ],
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
// fetchCalendar
// ---------------------------------------------------------------------------

describe("fetchCalendar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns parsed episode array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse(MOCK_EPISODES)));
    const result = await fetchCalendar(BASE_CONFIG);
    expect(result).toHaveLength(2);
    expect(result[0].seriesTitle).toBe("Breaking Bad");
    expect(result[0].episodeNumber).toBe(1);
  });

  it("sends X-Api-Key header (not a cookie)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_EPISODES));
    vi.stubGlobal("fetch", mockFetch);

    await fetchCalendar(BASE_CONFIG);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers["X-Api-Key"]).toBe("abc123secret");
    expect(options.headers.Cookie).toBeUndefined();
  });

  it("includes start and end ISO query params", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_EPISODES));
    vi.stubGlobal("fetch", mockFetch);

    await fetchCalendar(BASE_CONFIG);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v3/calendar");
    expect(url).toContain("start=");
    expect(url).toContain("end=");
    // Both should be valid ISO dates
    const params = new URL(url).searchParams;
    expect(() => new Date(params.get("start")!).toISOString()).not.toThrow();
    expect(() => new Date(params.get("end")!).toISOString()).not.toThrow();
  });

  it("start aligns to UTC midnight", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_EPISODES));
    vi.stubGlobal("fetch", mockFetch);

    await fetchCalendar(BASE_CONFIG);

    const [url] = mockFetch.mock.calls[0];
    const start = new URL(url).searchParams.get("start")!;
    const d = new Date(start);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
  });

  it("end is start + config.days days", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_EPISODES));
    vi.stubGlobal("fetch", mockFetch);

    const config = { ...BASE_CONFIG, days: 5 };
    await fetchCalendar(config);

    const [url] = mockFetch.mock.calls[0];
    const params = new URL(url).searchParams;
    const start = new Date(params.get("start")!);
    const end = new Date(params.get("end")!);
    const diffDays = (end.getTime() - start.getTime()) / 86_400_000;
    expect(diffDays).toBe(5);
  });

  it("throws on non-2xx response with status in message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeErrorResponse(401)));
    await expect(fetchCalendar(BASE_CONFIG)).rejects.toThrow("401");
  });

  it("forwards AbortSignal", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_EPISODES));
    vi.stubGlobal("fetch", mockFetch);

    const controller = new AbortController();
    await fetchCalendar(BASE_CONFIG, controller.signal);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.signal).toBe(controller.signal);
  });

  it("strips unknown fields silently via Zod", async () => {
    const withExtra = MOCK_EPISODES.map((e) => ({ ...e, unknownField: "foo" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse(withExtra)));
    const result = await fetchCalendar(BASE_CONFIG);
    expect(result[0]).not.toHaveProperty("unknownField");
  });

  it("maps series.title to flat seriesTitle on parsed output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse(MOCK_EPISODES)));
    const result = await fetchCalendar(BASE_CONFIG);
    expect(result[0].seriesTitle).toBe("Breaking Bad");
    expect(result[0]).not.toHaveProperty("series");
  });

  it("preserves base path in config.url when resolving API path", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_EPISODES));
    vi.stubGlobal("fetch", mockFetch);

    const configWithBasePath = { ...BASE_CONFIG, url: "http://sonarr.local:8989/sonarr/" };
    await fetchCalendar(configWithBasePath);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/sonarr/api/v3/calendar");
    expect(url).not.toMatch(/^http:\/\/sonarr\.local:8989\/api\//);
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

  it("sends correct path with pageSize param", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_QUEUE_RESPONSE));
    vi.stubGlobal("fetch", mockFetch);

    await fetchQueue(BASE_CONFIG);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v3/queue");
    expect(url).toContain("pageSize=25");
    expect(url).toContain("includeUnknownSeriesItems=false");
    expect(url).toContain("includeSeries=true");
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
      vi.fn().mockResolvedValue(makeJsonResponse({ records: [] }))
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
// Widget registration — sonarr-calendar
// ---------------------------------------------------------------------------

describe("sonarr-calendar widget registration", () => {
  beforeEach(() => {
    clearRegistry();
    vi.resetModules();
  });

  it("registers a widget with id 'sonarr-calendar' on import", async () => {
    await import("@/integrations/sonarr/calendarWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("sonarr-calendar")).toBeDefined();
  });

  it("widget name is 'Sonarr Calendar'", async () => {
    await import("@/integrations/sonarr/calendarWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("sonarr-calendar")?.name).toBe("Sonarr Calendar");
  });

  it("refreshInterval is 60000", async () => {
    await import("@/integrations/sonarr/calendarWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("sonarr-calendar")?.refreshInterval).toBe(60_000);
  });

  it("configSchema accepts valid config with days", async () => {
    await import("@/integrations/sonarr/calendarWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("sonarr-calendar")!.configSchema.safeParse({
      url: "http://192.168.1.10:8989",
      api_key: "myapikey",
      days: 14,
    });
    expect(result.success).toBe(true);
  });

  it("configSchema accepts omitted days (defaults to 7)", async () => {
    await import("@/integrations/sonarr/calendarWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("sonarr-calendar")!.configSchema.safeParse({
      url: "http://192.168.1.10:8989",
      api_key: "myapikey",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.days).toBe(7);
    }
  });

  it("configSchema rejects invalid URL", async () => {
    await import("@/integrations/sonarr/calendarWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("sonarr-calendar")!.configSchema.safeParse({
      url: "not-a-url",
      api_key: "myapikey",
    });
    expect(result.success).toBe(false);
  });

  it("configSchema rejects empty api_key", async () => {
    await import("@/integrations/sonarr/calendarWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("sonarr-calendar")!.configSchema.safeParse({
      url: "http://192.168.1.10:8989",
      api_key: "",
    });
    expect(result.success).toBe(false);
  });

  it("configFields contains url, api_key, and days keys", async () => {
    await import("@/integrations/sonarr/calendarWidget");
    const { getWidget } = await import("@/widgets");
    const fields = getWidget("sonarr-calendar")?.configFields ?? [];
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("url");
    expect(keys).toContain("api_key");
    expect(keys).toContain("days");
  });
});

// ---------------------------------------------------------------------------
// Widget registration — sonarr-queue
// ---------------------------------------------------------------------------

describe("sonarr-queue widget registration", () => {
  beforeEach(() => {
    clearRegistry();
    vi.resetModules();
  });

  it("registers a widget with id 'sonarr-queue' on import", async () => {
    await import("@/integrations/sonarr/queueWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("sonarr-queue")).toBeDefined();
  });

  it("widget name is 'Sonarr Queue'", async () => {
    await import("@/integrations/sonarr/queueWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("sonarr-queue")?.name).toBe("Sonarr Queue");
  });

  it("refreshInterval is 15000", async () => {
    await import("@/integrations/sonarr/queueWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("sonarr-queue")?.refreshInterval).toBe(15_000);
  });

  it("configSchema accepts valid config", async () => {
    await import("@/integrations/sonarr/queueWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("sonarr-queue")!.configSchema.safeParse({
      url: "http://192.168.1.10:8989",
      api_key: "myapikey",
    });
    expect(result.success).toBe(true);
  });

  it("configFields contains url and api_key but not days", async () => {
    await import("@/integrations/sonarr/queueWidget");
    const { getWidget } = await import("@/widgets");
    const fields = getWidget("sonarr-queue")?.configFields ?? [];
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("url");
    expect(keys).toContain("api_key");
    expect(keys).not.toContain("days");
  });
});
