// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  SystemStatsConfigSchema,
  DEFAULT_FIELDS,
  SAMPLE_INTERVAL_MS,
  resolveProcPath,
  resolveFields,
  parseProcStat,
  parseMeminfo,
  parseNetDev,
  parseLoadAvg,
  countCores,
  cpuUsageFromSamples,
  netRatesFromSamples,
  delay,
  fetchSystemStats,
} from "../../integrations/systemstats/api";
import type { NetCounters } from "../../integrations/systemstats/api";

// ---------------------------------------------------------------------------
// /proc fixtures (hand-built)
// ---------------------------------------------------------------------------

const STAT_FIXTURE = `cpu  100 0 100 800 0 0 0 0 0 0
cpu0 50 0 50 400 0 0 0 0 0 0
cpu1 50 0 50 400 0 0 0 0 0 0
intr 12345 0 0
ctxt 67890
btime 1700000000
processes 4321
`;

const MEMINFO_FIXTURE = `MemTotal:       16384000 kB
MemFree:         1000000 kB
MemAvailable:    8192000 kB
Buffers:          200000 kB
Cached:          3000000 kB
SwapCached:            0 kB
SwapTotal:       2000000 kB
SwapFree:        2000000 kB
`;

const NETDEV_FIXTURE = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:  123456     789    0    0    0     0          0         0   123456      789    0    0    0     0       0          0
  eth0: 1000000    5000    0    0    0     0          0         0    500000     4000    0    0    0     0       0          0
`;

const LOADAVG_FIXTURE = `0.42 0.55 0.60 1/234 5678
`;

const KB = 1024;

// ---------------------------------------------------------------------------
// Temp dirs: a fake proc tree plus a real dir to statfs for the disk field.
// ---------------------------------------------------------------------------

let baseDir: string;
let procDir: string;

beforeAll(() => {
  baseDir = mkdtempSync(path.join(tmpdir(), "kokpit-sysstats-"));
  procDir = path.join(baseDir, "proc");
  mkdirSync(path.join(procDir, "net"), { recursive: true });
  writeFileSync(path.join(procDir, "stat"), STAT_FIXTURE);
  writeFileSync(path.join(procDir, "meminfo"), MEMINFO_FIXTURE);
  writeFileSync(path.join(procDir, "net", "dev"), NETDEV_FIXTURE);
  writeFileSync(path.join(procDir, "loadavg"), LOADAVG_FIXTURE);
});

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

afterEach(() => {
  delete process.env.KOKPIT_PROC_PATH;
});

// ---------------------------------------------------------------------------
// Config schema + resolution
// ---------------------------------------------------------------------------

describe("SystemStatsConfigSchema", () => {
  it("accepts an empty config", () => {
    expect(SystemStatsConfigSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a fully populated config", () => {
    const parsed = SystemStatsConfigSchema.safeParse({
      proc_path: "/proc",
      disk_path: "/",
      interface: "eth0",
      docker_socket_path: "/var/run/docker.sock",
      fields: ["cpu", "memory", "disk", "network", "load", "docker"],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown field values", () => {
    expect(
      SystemStatsConfigSchema.safeParse({ fields: ["cpu", "gpu"] }).success
    ).toBe(false);
  });

  it("rejects empty string paths", () => {
    expect(SystemStatsConfigSchema.safeParse({ proc_path: "" }).success).toBe(false);
  });

  it("exposes the documented defaults", () => {
    expect(DEFAULT_FIELDS).toEqual(["cpu", "memory", "disk", "network"]);
    expect(SAMPLE_INTERVAL_MS).toBe(250);
  });
});

describe("resolveProcPath", () => {
  it("prefers explicit config over env and default", () => {
    process.env.KOKPIT_PROC_PATH = "/env/proc";
    expect(resolveProcPath({ proc_path: "/cfg/proc" })).toBe("/cfg/proc");
  });

  it("falls back to KOKPIT_PROC_PATH, then /proc", () => {
    process.env.KOKPIT_PROC_PATH = "/env/proc";
    expect(resolveProcPath({})).toBe("/env/proc");
    delete process.env.KOKPIT_PROC_PATH;
    expect(resolveProcPath({})).toBe("/proc");
  });
});

describe("resolveFields", () => {
  it("defaults to DEFAULT_FIELDS", () => {
    expect(resolveFields({})).toEqual(["cpu", "memory", "disk", "network"]);
  });

  it("dedupes requested fields", () => {
    expect(resolveFields({ fields: ["cpu", "cpu", "load", "load"] })).toEqual([
      "cpu",
      "load",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Pure parsers
// ---------------------------------------------------------------------------

describe("parseProcStat", () => {
  it("sums the aggregate cpu line into total and idle jiffies", () => {
    const sample = parseProcStat(STAT_FIXTURE);
    // total = 100 + 0 + 100 + 800 = 1000; idle = idle(800) + iowait(0)
    expect(sample.total).toBe(1000);
    expect(sample.idle).toBe(800);
  });

  it("throws when there is no aggregate cpu line", () => {
    expect(() => parseProcStat("intr 1 2 3\nctxt 4\n")).toThrow(/cpu line/i);
  });
});

describe("countCores", () => {
  it("counts per-core cpuN lines but not the aggregate cpu line", () => {
    expect(countCores(STAT_FIXTURE)).toBe(2);
  });

  it("returns 0 when there are no per-core lines", () => {
    expect(countCores("cpu 1 2 3 4\n")).toBe(0);
  });
});

describe("parseMeminfo", () => {
  it("uses MemTotal and MemAvailable, converting kB to bytes", () => {
    const { total, available } = parseMeminfo(MEMINFO_FIXTURE);
    expect(total).toBe(16384000 * KB);
    expect(available).toBe(8192000 * KB);
  });

  it("falls back to MemFree + Buffers + Cached when MemAvailable is missing", () => {
    const text = `MemTotal:       16384000 kB
MemFree:         1000000 kB
Buffers:          200000 kB
Cached:          3000000 kB
`;
    const { total, available } = parseMeminfo(text);
    expect(total).toBe(16384000 * KB);
    // available = 1000000 + 200000 + 3000000 = 4200000 kB
    expect(available).toBe(4200000 * KB);
    // used = total - available = 12184000 kB, i.e. MemTotal - MemFree - Buffers - Cached
    expect(total - available).toBe((16384000 - 4200000) * KB);
  });
});

describe("parseNetDev", () => {
  it("parses per-interface rx (col 0) and tx (col 8) bytes, skipping headers", () => {
    const parsed = parseNetDev(NETDEV_FIXTURE);
    expect(Object.keys(parsed).sort()).toEqual(["eth0", "lo"]);
    expect(parsed.eth0).toEqual({ rx: 1000000, tx: 500000 });
    expect(parsed.lo).toEqual({ rx: 123456, tx: 123456 });
  });

  it("ignores malformed lines", () => {
    expect(parseNetDev("garbage without colon\n")).toEqual({});
  });
});

describe("parseLoadAvg", () => {
  it("parses the first three floats", () => {
    expect(parseLoadAvg(LOADAVG_FIXTURE)).toEqual({
      one: 0.42,
      five: 0.55,
      fifteen: 0.6,
    });
  });

  it("defaults missing values to 0", () => {
    expect(parseLoadAvg("1.0")).toEqual({ one: 1.0, five: 0, fifteen: 0 });
  });
});

// ---------------------------------------------------------------------------
// Delta math
// ---------------------------------------------------------------------------

describe("cpuUsageFromSamples", () => {
  it("computes busy percentage across the interval", () => {
    // totalDelta 1000, idleDelta 900 → busy 100 → 10%
    expect(
      cpuUsageFromSamples({ total: 1000, idle: 800 }, { total: 2000, idle: 1700 })
    ).toBe(10);
  });

  it("returns 0 when the total delta is zero (identical samples)", () => {
    const s = { total: 1000, idle: 800 };
    expect(cpuUsageFromSamples(s, s)).toBe(0);
  });

  it("clamps to 0 when idle grows faster than total", () => {
    expect(
      cpuUsageFromSamples({ total: 1000, idle: 800 }, { total: 1100, idle: 950 })
    ).toBe(0);
  });
});

describe("netRatesFromSamples", () => {
  const prev: Record<string, NetCounters> = {
    lo: { rx: 9, tx: 9 },
    eth0: { rx: 1000, tx: 500 },
  };
  const cur: Record<string, NetCounters> = {
    lo: { rx: 99, tx: 99 },
    eth0: { rx: 3000, tx: 1500 },
  };

  it("sums non-loopback interfaces and divides by elapsed seconds", () => {
    const rates = netRatesFromSamples(prev, cur, 2);
    expect(rates.interfaces).toEqual(["eth0"]);
    expect(rates.rxBytesPerSec).toBe(1000); // (3000-1000)/2
    expect(rates.txBytesPerSec).toBe(500); // (1500-500)/2
  });

  it("honours a single-interface filter", () => {
    const withWlan = {
      ...cur,
      wlan0: { rx: 9999, tx: 9999 },
    };
    const withWlanPrev = {
      ...prev,
      wlan0: { rx: 0, tx: 0 },
    };
    const rates = netRatesFromSamples(withWlanPrev, withWlan, 2, "eth0");
    expect(rates.interfaces).toEqual(["eth0"]);
    expect(rates.rxBytesPerSec).toBe(1000);
  });

  it("clamps negative deltas (counter reset) to 0", () => {
    const reset: Record<string, NetCounters> = { eth0: { rx: 10, tx: 10 } };
    const rates = netRatesFromSamples(prev, reset, 2);
    expect(rates.rxBytesPerSec).toBe(0);
    expect(rates.txBytesPerSec).toBe(0);
  });

  it("returns 0 for a zero delta", () => {
    const rates = netRatesFromSamples(prev, prev, 2);
    expect(rates.rxBytesPerSec).toBe(0);
    expect(rates.txBytesPerSec).toBe(0);
  });

  it("returns 0 rates when elapsedSeconds is 0", () => {
    const rates = netRatesFromSamples(prev, cur, 0);
    expect(rates.rxBytesPerSec).toBe(0);
    expect(rates.txBytesPerSec).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// delay
// ---------------------------------------------------------------------------

describe("delay", () => {
  it("resolves after the interval", async () => {
    await expect(delay(5)).resolves.toBeUndefined();
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(delay(1000, ac.signal)).rejects.toThrow(/aborted/i);
  });

  it("rejects when the signal aborts mid-wait", async () => {
    const ac = new AbortController();
    const pending = delay(1000, ac.signal);
    ac.abort();
    await expect(pending).rejects.toThrow(/aborted/i);
  });
});

// ---------------------------------------------------------------------------
// fetchSystemStats
// ---------------------------------------------------------------------------

describe("fetchSystemStats", () => {
  it("reads every requested field from a proc tree + statfs", async () => {
    const data = await fetchSystemStats({
      fields: ["cpu", "memory", "disk", "network", "load"],
      proc_path: procDir,
      disk_path: baseDir,
    });

    // cpu — identical samples give 0% but the cores count is real
    expect(data.cpu).not.toBeNull();
    expect(data.cpu!.cores).toBe(2);
    expect(data.cpu!.usagePercent).toBe(0);

    // memory
    expect(data.memory).not.toBeNull();
    expect(data.memory!.total).toBe(16384000 * KB);
    expect(data.memory!.available).toBe(8192000 * KB);
    expect(data.memory!.used).toBe((16384000 - 8192000) * KB);
    expect(data.memory!.usagePercent).toBeCloseTo(50);

    // disk — real statfs against the temp dir
    expect(data.disk).not.toBeNull();
    expect(data.disk!.path).toBe(baseDir);
    expect(data.disk!.total).toBeGreaterThan(0);
    expect(data.disk!.usagePercent).toBeGreaterThanOrEqual(0);
    expect(data.disk!.usagePercent).toBeLessThanOrEqual(100);
    expect(data.disk!.used + data.disk!.available).toBeLessThanOrEqual(
      data.disk!.total
    );

    // network — identical samples give 0 rates; lo excluded
    expect(data.network).not.toBeNull();
    expect(data.network!.interfaces).toEqual(["eth0"]);
    expect(data.network!.rxBytesPerSec).toBe(0);
    expect(data.network!.txBytesPerSec).toBe(0);

    // load — cores reused from the cpu step
    expect(data.load).toEqual({ one: 0.42, five: 0.55, fifteen: 0.6, cores: 2 });

    // docker untouched
    expect(data.docker).toBeNull();
    expect(data.dockerError).toBeNull();
  });

  it("only computes requested fields, leaving the rest null", async () => {
    const data = await fetchSystemStats({
      fields: ["memory"],
      proc_path: procDir,
    });
    expect(data.memory).not.toBeNull();
    expect(data.cpu).toBeNull();
    expect(data.disk).toBeNull();
    expect(data.network).toBeNull();
    expect(data.load).toBeNull();
    expect(data.docker).toBeNull();
    expect(data.dockerError).toBeNull();
  });

  it("counts cores for load even when cpu is not requested", async () => {
    const data = await fetchSystemStats({
      fields: ["load"],
      proc_path: procDir,
    });
    expect(data.cpu).toBeNull();
    expect(data.load).not.toBeNull();
    expect(data.load!.cores).toBe(2);
  });

  it("reports an actionable error when a proc file is missing", async () => {
    await expect(
      fetchSystemStats({
        fields: ["memory"],
        proc_path: path.join(baseDir, "does-not-exist"),
      })
    ).rejects.toThrow(/Cannot read .* is this a Linux host/i);
  });

  it("degrades to dockerError without throwing when the socket is missing", async () => {
    const data = await fetchSystemStats({
      fields: ["docker"],
      docker_socket_path: path.join(baseDir, "nonexistent-docker.sock"),
    });
    expect(data.docker).toBeNull();
    expect(data.dockerError).not.toBeNull();
    expect(typeof data.dockerError).toBe("string");
    // other fields stay null; the widget renders the rest fine
    expect(data.cpu).toBeNull();
    expect(data.memory).toBeNull();
  });
});
