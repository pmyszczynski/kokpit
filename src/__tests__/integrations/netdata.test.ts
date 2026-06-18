// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearRegistry } from "@/widgets";
import {
  fetchAllMetrics,
  fetchChartHistory,
  extractCpu,
  extractRam,
  extractNet,
  extractDiskIo,
  extractDiskSpace,
  extractLoad,
  extractSensor,
} from "@/integrations/netdata/api";
import type { AllMetrics } from "@/integrations/netdata/api";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeJsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function makeErrorResponse(status: number) {
  return { ok: false, status };
}

// Each test uses a unique URL so the module-level cache never bleeds across tests.
let urlCounter = 0;
function uniqueUrl(): string {
  return `http://netdata-${++urlCounter}.local:19999`;
}

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const MOCK_ALLMETRICS_BODY = {
  charts: {
    "system.cpu": {
      family: "cpu",
      units: "percentage",
      dimensions: {
        user: { value: 2.0 },
        system: { value: 1.0 },
        idle: { value: 97.0 },
      },
    },
    "system.ram": {
      family: "mem",
      units: "MiB",
      dimensions: {
        free: { value: 4096 },
        used: { value: 8192 },
        cached: { value: 2048 },
        buffers: { value: 512 },
      },
    },
    "system.net": {
      family: "net",
      units: "kilobits/s",
      dimensions: {
        received: { value: 8000 },
        sent: { value: 4000 },
      },
    },
    "system.io": {
      family: "disk",
      units: "KiB/s",
      dimensions: {
        in: { value: 100 },
        out: { value: 50 },
      },
    },
    "disk_space._": {
      family: "space",
      units: "GiB",
      dimensions: {
        avail: { value: 256 },
        used: { value: 128 },
        reserved_for_root: { value: 16 },
      },
    },
    "system.load": {
      family: "load",
      units: "load",
      dimensions: {
        load1: { value: 1.5 },
        load5: { value: 1.2 },
        load15: { value: 1.0 },
      },
    },
    "sensors.coretemp_isa_0000": {
      family: "cpu",
      units: "Celsius",
      dimensions: {
        "Package id 0": { value: 54 },
        "Core 0": { value: 52 },
        "Core 1": { value: 50 },
      },
    },
  },
};

const MOCK_HISTORY_BODY = {
  dimension_names: ["user", "system", "idle"],
  data: [
    [1716761234, 2.0, 1.0, 97.0],
    [1716761244, 3.0, 1.5, 95.5],
  ],
};

// ---------------------------------------------------------------------------
// fetchAllMetrics
// ---------------------------------------------------------------------------

describe("fetchAllMetrics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("calls /api/v1/allmetrics with format=json&help=no", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_ALLMETRICS_BODY));
    vi.stubGlobal("fetch", mockFetch);

    await fetchAllMetrics({ url: uniqueUrl() });

    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain("/api/v1/allmetrics");
    expect(url).toContain("format=json");
  });

  it("returns parsed AllMetrics with correct chart dimensions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse(MOCK_ALLMETRICS_BODY)));

    const result = await fetchAllMetrics({ url: uniqueUrl() });

    expect(result.charts["system.cpu"]?.dimensions["idle"]?.value).toBe(97.0);
    expect(result.charts["system.ram"]?.dimensions["used"]?.value).toBe(8192);
  });

  it("sends X-Netdata-Auth header when api_token is set", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_ALLMETRICS_BODY));
    vi.stubGlobal("fetch", mockFetch);

    await fetchAllMetrics({ url: uniqueUrl(), api_token: "mysecrettoken" });

    const headers: Record<string, string> = mockFetch.mock.calls[0][1].headers;
    expect(headers["X-Netdata-Auth"]).toBe("Bearer mysecrettoken");
  });

  it("does not send X-Netdata-Auth when api_token is absent", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_ALLMETRICS_BODY));
    vi.stubGlobal("fetch", mockFetch);

    await fetchAllMetrics({ url: uniqueUrl() });

    const headers: Record<string, string> = mockFetch.mock.calls[0][1].headers;
    expect(headers["X-Netdata-Auth"]).toBeUndefined();
  });

  it("throws with status code on non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeErrorResponse(401)));

    await expect(fetchAllMetrics({ url: uniqueUrl() })).rejects.toThrow("401");
  });

  it("forwards AbortSignal", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_ALLMETRICS_BODY));
    vi.stubGlobal("fetch", mockFetch);
    const controller = new AbortController();

    await fetchAllMetrics({ url: uniqueUrl() }, controller.signal);

    expect(mockFetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  it("caches response — second call with same URL makes only one fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_ALLMETRICS_BODY));
    vi.stubGlobal("fetch", mockFetch);
    const config = { url: uniqueUrl() };

    await fetchAllMetrics(config);
    await fetchAllMetrics(config);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("fetches again after cache TTL expires", async () => {
    vi.useFakeTimers();
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_ALLMETRICS_BODY));
    vi.stubGlobal("fetch", mockFetch);
    const config = { url: uniqueUrl() };

    await fetchAllMetrics(config);
    vi.advanceTimersByTime(10_000); // past the 9s TTL
    await fetchAllMetrics(config);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("two different URLs each make their own fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_ALLMETRICS_BODY));
    vi.stubGlobal("fetch", mockFetch);

    await fetchAllMetrics({ url: uniqueUrl() });
    await fetchAllMetrics({ url: uniqueUrl() });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// fetchChartHistory
// ---------------------------------------------------------------------------

describe("fetchChartHistory", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("calls /api/v1/data with the correct chart ID", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_HISTORY_BODY));
    vi.stubGlobal("fetch", mockFetch);

    await fetchChartHistory({ url: "http://netdata.local:19999" }, "system.cpu");

    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain("/api/v1/data");
    expect(url).toContain("chart=system.cpu");
  });

  it("uses history_minutes to set the after parameter", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_HISTORY_BODY));
    vi.stubGlobal("fetch", mockFetch);

    await fetchChartHistory(
      { url: "http://netdata.local:19999", history_minutes: 30 },
      "system.cpu"
    );

    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain("after=-1800");
  });

  it("defaults to 10-minute history window", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_HISTORY_BODY));
    vi.stubGlobal("fetch", mockFetch);

    await fetchChartHistory({ url: "http://netdata.local:19999" }, "system.cpu");

    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain("after=-600");
  });

  it("returns dimensionNames and rows from the response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse(MOCK_HISTORY_BODY)));

    const result = await fetchChartHistory({ url: "http://netdata.local:19999" }, "system.cpu");

    expect(result.dimensionNames).toEqual(["user", "system", "idle"]);
    // rows strip the leading timestamp column
    expect(result.rows).toEqual([
      [2.0, 1.0, 97.0],
      [3.0, 1.5, 95.5],
    ]);
  });

  it("throws with status code on non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeErrorResponse(404)));

    await expect(
      fetchChartHistory({ url: "http://netdata.local:19999" }, "nonexistent")
    ).rejects.toThrow("404");
  });
});

// ---------------------------------------------------------------------------
// Extractor functions (pure — no fetch mocking needed)
// ---------------------------------------------------------------------------

const METRICS = MOCK_ALLMETRICS_BODY as AllMetrics;

describe("extractCpu", () => {
  it("returns 100 minus the idle dimension value", () => {
    expect(extractCpu(METRICS)).toBeCloseTo(3.0);
  });

  it("throws when system.cpu chart is missing", () => {
    expect(() => extractCpu({ charts: {} })).toThrow("system.cpu");
  });

  it("returns 0 when idle is 100", () => {
    const m: AllMetrics = {
      charts: {
        "system.cpu": {
          dimensions: { idle: { value: 100 }, user: { value: 0 } },
        },
      },
    };
    expect(extractCpu(m)).toBe(0);
  });
});

describe("extractRam", () => {
  it("returns used and total bytes converted from MiB", () => {
    const { usedBytes, totalBytes } = extractRam(METRICS);
    const MiB = 1024 * 1024;
    // total = free + used + cached + buffers = (4096 + 8192 + 2048 + 512) MiB
    expect(totalBytes).toBe((4096 + 8192 + 2048 + 512) * MiB);
    // usedBytes = total - free
    expect(usedBytes).toBe((8192 + 2048 + 512) * MiB);
  });

  it("throws when system.ram chart is missing", () => {
    expect(() => extractRam({ charts: {} })).toThrow("system.ram");
  });
});

describe("extractNet", () => {
  it("converts kilobits/s to bytes/s (received and sent)", () => {
    const { inBps, outBps } = extractNet(METRICS);
    // 8000 kbits/s → 8000 * 1000 / 8 = 1_000_000 B/s
    expect(inBps).toBe(1_000_000);
    // 4000 kbits/s → 500_000 B/s
    expect(outBps).toBe(500_000);
  });

  it("throws when system.net chart is missing", () => {
    expect(() => extractNet({ charts: {} })).toThrow("system.net");
  });
});

describe("extractDiskIo", () => {
  it("converts KiB/s to bytes/s", () => {
    const { readBps, writeBps } = extractDiskIo(METRICS);
    expect(readBps).toBe(100 * 1024);
    expect(writeBps).toBe(50 * 1024);
  });

  it("throws when system.io chart is missing", () => {
    expect(() => extractDiskIo({ charts: {} })).toThrow("system.io");
  });
});

describe("extractDiskSpace", () => {
  it("converts GiB to bytes and returns used and total", () => {
    const { usedBytes, totalBytes } = extractDiskSpace(METRICS);
    const GiB = 1024 ** 3;
    expect(usedBytes).toBe(128 * GiB);
    expect(totalBytes).toBe((256 + 128 + 16) * GiB);
  });

  it("uses custom chartId when provided", () => {
    const m: AllMetrics = {
      charts: {
        "disk_space._home": {
          dimensions: {
            avail: { value: 100 },
            used: { value: 50 },
            reserved_for_root: { value: 0 },
          },
        },
      },
    };
    const { usedBytes } = extractDiskSpace(m, "disk_space._home");
    expect(usedBytes).toBe(50 * 1024 ** 3);
  });

  it("throws when the chart is missing", () => {
    expect(() => extractDiskSpace({ charts: {} })).toThrow("disk_space._");
  });
});

describe("extractLoad", () => {
  it("returns 1m, 5m, 15m load averages", () => {
    const result = extractLoad(METRICS);
    expect(result).toEqual({ one: 1.5, five: 1.2, fifteen: 1.0 });
  });

  it("throws when system.load chart is missing", () => {
    expect(() => extractLoad({ charts: {} })).toThrow("system.load");
  });
});

describe("extractSensor", () => {
  it("averages all dimension values and returns units", () => {
    const result = extractSensor(METRICS, "sensors.coretemp_isa_0000");
    // avg of 54, 52, 50 = 52
    expect(result?.value).toBeCloseTo(52);
    expect(result?.units).toBe("Celsius");
  });

  it("returns null when chart does not exist", () => {
    expect(extractSensor(METRICS, "sensors.nonexistent")).toBeNull();
  });

  it("returns null when chart has no valid dimension values", () => {
    const m: AllMetrics = {
      charts: {
        "sensors.broken": {
          dimensions: {
            temp1: { value: null },
          },
        },
      },
    };
    expect(extractSensor(m, "sensors.broken")).toBeNull();
  });

  it("returns Celsius even when a single dimension is null (skips nulls in average)", () => {
    const m: AllMetrics = {
      charts: {
        "sensors.partial": {
          units: "Celsius",
          dimensions: {
            "Core 0": { value: 60 },
            "Core 1": { value: null },
          },
        },
      },
    };
    const result = extractSensor(m, "sensors.partial");
    expect(result?.value).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// Widget registration
// ---------------------------------------------------------------------------

describe("netdata widget registration", () => {
  beforeEach(() => {
    clearRegistry();
    vi.resetModules();
  });

  it.each([
    ["netdata-cpu", "@/integrations/netdata/cpuWidget", "Netdata CPU"],
    ["netdata-ram", "@/integrations/netdata/ramWidget", "Netdata RAM"],
    ["netdata-net", "@/integrations/netdata/netWidget", "Netdata Network"],
    ["netdata-disk-io", "@/integrations/netdata/diskIoWidget", "Netdata Disk I/O"],
    ["netdata-disk-space", "@/integrations/netdata/diskSpaceWidget", "Netdata Disk Space"],
    ["netdata-load", "@/integrations/netdata/loadWidget", "Netdata Load"],
    ["netdata-sensor", "@/integrations/netdata/sensorWidget", "Netdata Sensor"],
  ] as const)(
    "registers '%s' with correct name on import",
    async (id, path, expectedName) => {
      await import(path);
      const { getWidget } = await import("@/widgets");
      const widget = getWidget(id);
      expect(widget).toBeDefined();
      expect(widget?.name).toBe(expectedName);
    }
  );

  it("netdata-cpu has 10s refresh interval", async () => {
    await import("@/integrations/netdata/cpuWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("netdata-cpu")?.refreshInterval).toBe(10_000);
  });

  it("netdata-disk-space has 60s refresh interval", async () => {
    await import("@/integrations/netdata/diskSpaceWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("netdata-disk-space")?.refreshInterval).toBe(60_000);
  });

  it("base configSchema accepts valid config (url only)", async () => {
    await import("@/integrations/netdata/cpuWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("netdata-cpu")!.configSchema.safeParse({
      url: "http://192.168.1.10:19999",
    });
    expect(result.success).toBe(true);
  });

  it("base configSchema rejects invalid URL", async () => {
    await import("@/integrations/netdata/cpuWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("netdata-cpu")!.configSchema.safeParse({ url: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("base configSchema accepts optional api_token and history_minutes", async () => {
    await import("@/integrations/netdata/ramWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("netdata-ram")!.configSchema.safeParse({
      url: "http://192.168.1.10:19999",
      api_token: "mytoken",
      history_minutes: 30,
    });
    expect(result.success).toBe(true);
  });

  it("netdata-sensor configSchema requires chart_id", async () => {
    await import("@/integrations/netdata/sensorWidget");
    const { getWidget } = await import("@/widgets");
    const withoutChartId = getWidget("netdata-sensor")!.configSchema.safeParse({
      url: "http://192.168.1.10:19999",
    });
    expect(withoutChartId.success).toBe(false);

    const withChartId = getWidget("netdata-sensor")!.configSchema.safeParse({
      url: "http://192.168.1.10:19999",
      chart_id: "sensors.coretemp_isa_0000",
    });
    expect(withChartId.success).toBe(true);
  });

  it("netdata-sensor configFields includes chart_id and label keys", async () => {
    await import("@/integrations/netdata/sensorWidget");
    const { getWidget } = await import("@/widgets");
    const keys = getWidget("netdata-sensor")!.configFields!.map((f) => f.key);
    expect(keys).toContain("chart_id");
    expect(keys).toContain("label");
  });

  it("all 7 widgets have serviceEditorPreset", async () => {
    await import("@/integrations/netdata/cpuWidget");
    await import("@/integrations/netdata/ramWidget");
    await import("@/integrations/netdata/netWidget");
    await import("@/integrations/netdata/diskIoWidget");
    await import("@/integrations/netdata/diskSpaceWidget");
    await import("@/integrations/netdata/loadWidget");
    await import("@/integrations/netdata/sensorWidget");
    const { getAllWidgets } = await import("@/widgets");
    const netdataWidgets = getAllWidgets().filter((w) => w.id.startsWith("netdata-"));
    expect(netdataWidgets).toHaveLength(7);
    for (const w of netdataWidgets) {
      expect(w.serviceEditorPreset).toBeDefined();
    }
  });
});
