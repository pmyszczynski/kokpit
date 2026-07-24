// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearRegistry } from "@/widgets";
import { fetchTdarrStats } from "@/integrations/tdarr/api";

const BASE_CONFIG = {
  url: "http://tdarr.local:8265",
  apikey: "abc123def456",
};

const MOCK_STATISTICS_RESPONSE = {
  table1Count: 12,
  table1ViewableCount: 10,
  table2Count: 500,
  table2ViewableCount: 480,
  table3Count: 3,
  table3ViewableCount: 2,
  table4Count: 7,
  table4ViewableCount: 5,
  table6Count: 1,
  table6ViewableCount: 1,
  sizeDiff: 123.45,
  totalFileCount: 1000,
};

const MOCK_NODES_RESPONSE = {
  node1: {
    workers: {
      worker1: { fps: 25.5 },
      worker2: { fps: 30 },
    },
  },
  node2: {
    workers: {
      worker3: { fps: 10.25 },
    },
  },
};

function makeJsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function makeErrorResponse(status: number) {
  return { ok: false, status, json: async () => ({}) };
}

function makeFetchMock(
  cruddbResponse: unknown,
  nodesResponse: unknown
): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.includes("cruddb")) {
      return cruddbResponse;
    }
    if (url.includes("get-nodes")) {
      return nodesResponse;
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
}

// ---------------------------------------------------------------------------
// fetchTdarrStats
// ---------------------------------------------------------------------------

describe("fetchTdarrStats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns correctly transformed data", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(
        makeJsonResponse(MOCK_STATISTICS_RESPONSE),
        makeJsonResponse(MOCK_NODES_RESPONSE)
      )
    );

    const result = await fetchTdarrStats(BASE_CONFIG);

    expect(result).toEqual({
      transcodeQueue: 10,
      healthCheckQueue: 5,
      transcoded: 480,
      errored: 3,
      spaceSavedGb: 123.45,
      totalFiles: 1000,
      activeWorkers: 3,
      fps: 65.8,
    });
  });

  it("falls back to the non-viewable counts when viewable counts are absent", async () => {
    const fallbackStats = {
      table1Count: 12,
      table2Count: 500,
      table3Count: 3,
      table4Count: 7,
      table6Count: 1,
      sizeDiff: 50,
      totalFileCount: 1000,
    };
    vi.stubGlobal(
      "fetch",
      makeFetchMock(makeJsonResponse(fallbackStats), makeJsonResponse({}))
    );

    const result = await fetchTdarrStats(BASE_CONFIG);

    expect(result.transcodeQueue).toBe(12);
    expect(result.healthCheckQueue).toBe(7);
    expect(result.transcoded).toBe(500);
    expect(result.errored).toBe(4);
  });

  it("builds the correct cruddb POST request with headers and body", async () => {
    const mockFetch = makeFetchMock(
      makeJsonResponse(MOCK_STATISTICS_RESPONSE),
      makeJsonResponse(MOCK_NODES_RESPONSE)
    );
    vi.stubGlobal("fetch", mockFetch);

    await fetchTdarrStats(BASE_CONFIG);

    const cruddbCall = mockFetch.mock.calls.find((call) =>
      (call[0] as string).includes("cruddb")
    );
    expect(cruddbCall).toBeDefined();
    const [calledUrl, options] = cruddbCall as [string, RequestInit];
    expect(calledUrl).toBe("http://tdarr.local:8265/api/v2/cruddb");
    expect(options.method).toBe("POST");
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
    expect((options.headers as Record<string, string>)["x-api-key"]).toBe(
      "abc123def456"
    );
    expect(JSON.parse(options.body as string)).toEqual({
      data: {
        collection: "StatisticsJSONDB",
        mode: "getById",
        docID: "statistics",
      },
    });
  });

  it("omits the x-api-key header when no apikey is configured", async () => {
    const mockFetch = makeFetchMock(
      makeJsonResponse(MOCK_STATISTICS_RESPONSE),
      makeJsonResponse(MOCK_NODES_RESPONSE)
    );
    vi.stubGlobal("fetch", mockFetch);

    await fetchTdarrStats({ url: BASE_CONFIG.url });

    const cruddbCall = mockFetch.mock.calls.find((call) =>
      (call[0] as string).includes("cruddb")
    );
    const [, options] = cruddbCall as [string, RequestInit];
    expect(
      (options.headers as Record<string, string>)["x-api-key"]
    ).toBeUndefined();
  });

  it("throws when the cruddb response is non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(makeErrorResponse(403), makeJsonResponse(MOCK_NODES_RESPONSE))
    );

    await expect(fetchTdarrStats(BASE_CONFIG)).rejects.toThrow("403");
  });

  it("throws when the cruddb response is 500", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(makeErrorResponse(500), makeJsonResponse(MOCK_NODES_RESPONSE))
    );

    await expect(fetchTdarrStats(BASE_CONFIG)).rejects.toThrow("500");
  });

  it("forwards the AbortSignal to the cruddb request", async () => {
    const mockFetch = makeFetchMock(
      makeJsonResponse(MOCK_STATISTICS_RESPONSE),
      makeJsonResponse(MOCK_NODES_RESPONSE)
    );
    vi.stubGlobal("fetch", mockFetch);

    const controller = new AbortController();
    await fetchTdarrStats(BASE_CONFIG, controller.signal);

    const cruddbCall = mockFetch.mock.calls.find((call) =>
      (call[0] as string).includes("cruddb")
    );
    const [, options] = cruddbCall as [string, RequestInit];
    expect(options).toMatchObject({ signal: controller.signal });
  });

  it("defaults activeWorkers and fps to 0 when get-nodes returns a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(makeJsonResponse(MOCK_STATISTICS_RESPONSE), makeErrorResponse(500))
    );

    const result = await fetchTdarrStats(BASE_CONFIG);

    expect(result.activeWorkers).toBe(0);
    expect(result.fps).toBe(0);
    // Primary stats are unaffected by the get-nodes failure.
    expect(result.transcodeQueue).toBe(10);
  });

  it("defaults activeWorkers and fps to 0 when get-nodes returns garbage JSON", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(
        makeJsonResponse(MOCK_STATISTICS_RESPONSE),
        makeJsonResponse("not an object")
      )
    );

    const result = await fetchTdarrStats(BASE_CONFIG);

    expect(result.activeWorkers).toBe(0);
    expect(result.fps).toBe(0);
  });

  it("defaults activeWorkers and fps to 0 when get-nodes rejects (network error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("cruddb")) {
          return makeJsonResponse(MOCK_STATISTICS_RESPONSE);
        }
        throw new Error("network error");
      })
    );

    const result = await fetchTdarrStats(BASE_CONFIG);

    expect(result.activeWorkers).toBe(0);
    expect(result.fps).toBe(0);
    expect(result.transcodeQueue).toBe(10);
  });

  it("accepts a cruddb response wrapped under a 'statistics' key", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(
        makeJsonResponse({ statistics: MOCK_STATISTICS_RESPONSE }),
        makeJsonResponse(MOCK_NODES_RESPONSE)
      )
    );

    const result = await fetchTdarrStats(BASE_CONFIG);

    expect(result.transcodeQueue).toBe(10);
    expect(result.spaceSavedGb).toBe(123.45);
  });
});

// ---------------------------------------------------------------------------
// Widget registration
// ---------------------------------------------------------------------------

describe("tdarr-stats widget registration", () => {
  beforeEach(() => {
    clearRegistry();
    vi.resetModules();
  });

  it("registers a widget with id 'tdarr-stats' on import", async () => {
    await import("@/integrations/tdarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("tdarr-stats")).toBeDefined();
  });

  it("widget name is 'Tdarr Stats'", async () => {
    await import("@/integrations/tdarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("tdarr-stats")?.name).toBe("Tdarr Stats");
  });

  it("refreshInterval is 10000", async () => {
    await import("@/integrations/tdarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("tdarr-stats")?.refreshInterval).toBe(10_000);
  });

  it("preferredSize is 'wide'", async () => {
    await import("@/integrations/tdarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("tdarr-stats")?.preferredSize).toBe("wide");
  });

  it("serviceEditorPreset has the expected default name and icon", async () => {
    await import("@/integrations/tdarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("tdarr-stats")?.serviceEditorPreset).toEqual({
      defaultName: "Tdarr",
      defaultIconUrl: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/tdarr.svg",
    });
  });

  it("configSchema accepts valid config", async () => {
    await import("@/integrations/tdarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("tdarr-stats")!.configSchema.safeParse({
      url: "http://192.168.1.10:8265",
      apikey: "abc123",
    });
    expect(result.success).toBe(true);
  });

  it("configSchema accepts valid config without an apikey", async () => {
    await import("@/integrations/tdarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("tdarr-stats")!.configSchema.safeParse({
      url: "http://192.168.1.10:8265",
    });
    expect(result.success).toBe(true);
  });

  it("configSchema rejects missing url", async () => {
    await import("@/integrations/tdarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("tdarr-stats")!.configSchema.safeParse({
      apikey: "abc123",
    });
    expect(result.success).toBe(false);
  });

  it("configSchema rejects an invalid URL", async () => {
    await import("@/integrations/tdarr/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("tdarr-stats")!.configSchema.safeParse({
      url: "not-a-url",
    });
    expect(result.success).toBe(false);
  });
});
