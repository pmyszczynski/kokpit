import { describe, it, expect, vi, afterEach } from "vitest";
import "@/integrations";
import { getWidget } from "@/widgets";

// The netdata fetch*Data functions are module-private and only reachable
// through the widget registry, so these tests drive them the same way the
// widget API route does: getWidget(id).fetchData(config).
//
// fetchAllMetrics caches per url+token for 9s (module-level), so every test
// uses a distinct URL to stay independent.

type Charts = Record<
  string,
  { units?: string; dimensions: Record<string, { value: number | null }> }
>;

interface HistoryPayload {
  dimension_names: string[];
  data: Array<[number, ...number[]]>;
}

function stubNetdataFetch({
  charts,
  history,
  failHistory = false,
}: {
  charts: Charts;
  history?: HistoryPayload;
  failHistory?: boolean;
}) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.includes("allmetrics")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ charts }),
      } as Response);
    }
    if (failHistory) {
      return Promise.resolve({ ok: false, status: 500 } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve(history ?? { dimension_names: [], data: [] }),
    } as Response);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function fetchData(
  id: string,
  config: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const def = getWidget(id);
  if (!def) throw new Error(`widget "${id}" not registered`);
  return def.fetchData(config) as Promise<Record<string, unknown>>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("netdata-cpu fetchData", () => {
  it("computes usage from idle and maps history rows to 100 - idle", async () => {
    stubNetdataFetch({
      charts: { "system.cpu": { dimensions: { idle: { value: 60 } } } },
      history: {
        dimension_names: ["idle"],
        data: [
          [1, 80],
          [2, 90],
        ],
      },
    });
    const data = await fetchData("netdata-cpu", { url: "http://nd-cpu.test" });
    expect(data).toEqual({ current: 40, history: [20, 10] });
  });

  it("falls back to empty history when the history request fails", async () => {
    stubNetdataFetch({
      charts: { "system.cpu": { dimensions: { idle: { value: 75 } } } },
      failHistory: true,
    });
    const data = await fetchData("netdata-cpu", {
      url: "http://nd-cpu-nohist.test",
    });
    expect(data).toEqual({ current: 25, history: [] });
  });
});

describe("netdata-ram fetchData", () => {
  const MiB = 1024 * 1024;

  it("converts MiB dimensions to bytes and sums history components", async () => {
    stubNetdataFetch({
      charts: {
        "system.ram": {
          dimensions: {
            free: { value: 1024 },
            used: { value: 2048 },
            cached: { value: 512 },
            buffers: { value: 512 },
          },
        },
      },
      history: {
        dimension_names: ["used", "cached", "buffers"],
        data: [[1, 100, 50, 50]],
      },
    });
    const data = await fetchData("netdata-ram", { url: "http://nd-ram.test" });
    expect(data).toEqual({
      usedBytes: 3072 * MiB,
      totalBytes: 4096 * MiB,
      history: [200 * MiB],
    });
  });
});

describe("netdata-net fetchData", () => {
  it("converts kilobits/s to bytes/s for current values and history", async () => {
    stubNetdataFetch({
      charts: {
        "system.net": {
          dimensions: { received: { value: -800 }, sent: { value: 80 } },
        },
      },
      history: {
        dimension_names: ["received", "sent"],
        data: [[1, -16, 8]],
      },
    });
    const data = await fetchData("netdata-net", { url: "http://nd-net.test" });
    expect(data).toEqual({
      inBps: 100_000,
      outBps: 10_000,
      inHistory: [2000],
      outHistory: [1000],
    });
  });

  it("returns empty histories when the history chart lacks the dimensions", async () => {
    stubNetdataFetch({
      charts: {
        "system.net": {
          dimensions: { received: { value: 8 }, sent: { value: 8 } },
        },
      },
      history: { dimension_names: ["other"], data: [[1, 5]] },
    });
    const data = await fetchData("netdata-net", {
      url: "http://nd-net-nodims.test",
    });
    expect(data.inHistory).toEqual([]);
    expect(data.outHistory).toEqual([]);
  });
});

describe("netdata-disk-io fetchData", () => {
  it("converts KiB/s to bytes/s for current values and history", async () => {
    stubNetdataFetch({
      charts: {
        "system.io": {
          dimensions: { in: { value: 100 }, out: { value: -50 } },
        },
      },
      history: {
        dimension_names: ["in", "out"],
        data: [[1, 10, -20]],
      },
    });
    const data = await fetchData("netdata-disk-io", {
      url: "http://nd-io.test",
    });
    expect(data).toEqual({
      readBps: 100 * 1024,
      writeBps: 50 * 1024,
      readHistory: [10 * 1024],
      writeHistory: [20 * 1024],
    });
  });
});

describe("netdata-disk-space fetchData", () => {
  const GiB = 1024 ** 3;

  it("reads the default disk_space._ chart in GiB", async () => {
    stubNetdataFetch({
      charts: {
        "disk_space._": {
          dimensions: {
            avail: { value: 100 },
            used: { value: 300 },
            reserved_for_root: { value: 12 },
          },
        },
      },
    });
    const data = await fetchData("netdata-disk-space", {
      url: "http://nd-disk.test",
    });
    expect(data).toEqual({ usedBytes: 300 * GiB, totalBytes: 412 * GiB });
  });

  it("honors a custom chart_id", async () => {
    stubNetdataFetch({
      charts: {
        "disk_space./mnt": {
          dimensions: {
            avail: { value: 10 },
            used: { value: 30 },
            reserved_for_root: { value: 0 },
          },
        },
      },
    });
    const data = await fetchData("netdata-disk-space", {
      url: "http://nd-disk-mnt.test",
      chart_id: "disk_space./mnt",
    });
    expect(data).toEqual({ usedBytes: 30 * GiB, totalBytes: 40 * GiB });
  });
});

describe("netdata-load fetchData", () => {
  it("returns the 1m/5m/15m load averages", async () => {
    stubNetdataFetch({
      charts: {
        "system.load": {
          dimensions: {
            load1: { value: 1.5 },
            load5: { value: 1.0 },
            load15: { value: 0.5 },
          },
        },
      },
    });
    const data = await fetchData("netdata-load", { url: "http://nd-load.test" });
    expect(data).toEqual({ one: 1.5, five: 1.0, fifteen: 0.5 });
  });
});

describe("netdata-sensor fetchData", () => {
  it("averages the chart dimensions and derives the default label", async () => {
    stubNetdataFetch({
      charts: {
        "sensors.cpu_temp": {
          units: "Celsius",
          dimensions: { a: { value: 50 }, b: { value: 60 } },
        },
      },
      history: {
        dimension_names: ["a", "b"],
        data: [[1, 40, 60]],
      },
    });
    const data = await fetchData("netdata-sensor", {
      url: "http://nd-sensor.test",
      chart_id: "sensors.cpu_temp",
    });
    expect(data).toEqual({
      value: 55,
      units: "Celsius",
      history: [50],
      label: "cpu_temp",
    });
  });

  it("prefers an explicit label over the chart id", async () => {
    stubNetdataFetch({
      charts: {
        "sensors.fan": { units: "RPM", dimensions: { a: { value: 1200 } } },
      },
    });
    const data = await fetchData("netdata-sensor", {
      url: "http://nd-sensor-label.test",
      chart_id: "sensors.fan",
      label: "Case Fan",
    });
    expect(data.label).toBe("Case Fan");
  });

  it("throws a helpful error when the chart does not exist", async () => {
    stubNetdataFetch({ charts: {} });
    await expect(
      fetchData("netdata-sensor", {
        url: "http://nd-sensor-missing.test",
        chart_id: "sensors.none",
      })
    ).rejects.toThrow(/sensors\.none.*not found/);
  });
});
