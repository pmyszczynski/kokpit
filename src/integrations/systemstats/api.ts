import { z } from "zod";
import { fetchDockerData } from "../docker/api";

// The set of stat rows the widget can display. Declared once so the schema, the
// exported field type, and DEFAULT_FIELDS all stay in sync.
const FIELD_VALUES = [
  "cpu",
  "memory",
  "disk",
  "network",
  "load",
  "docker",
] as const;

export type SystemStatsField = (typeof FIELD_VALUES)[number];

export const SystemStatsConfigSchema = z.object({
  proc_path: z.string().min(1).optional(), // default: KOKPIT_PROC_PATH env, then "/proc"
  disk_path: z.string().min(1).optional(), // default "/"
  interface: z.string().min(1).optional(), // network iface filter; default: all non-loopback
  docker_socket_path: z.string().min(1).optional(), // used only when "docker" in fields
  fields: z.array(z.enum(FIELD_VALUES)).optional(),
});

// z.input (not z.infer): every field is optional and defaults are resolved at
// fetch time, so callers may pass a bare {}.
export type SystemStatsConfig = z.input<typeof SystemStatsConfigSchema>;

export const DEFAULT_FIELDS = ["cpu", "memory", "disk", "network"] as const;

export interface SystemStatsData {
  cpu: { usagePercent: number; cores: number } | null; // usagePercent 0-100
  memory: { total: number; used: number; available: number; usagePercent: number } | null; // bytes
  disk: { path: string; total: number; used: number; available: number; usagePercent: number } | null; // bytes
  network: { rxBytesPerSec: number; txBytesPerSec: number; interfaces: string[] } | null;
  load: { one: number; five: number; fifteen: number; cores: number } | null;
  docker: { running: number; total: number } | null;
  dockerError: string | null; // set when "docker" requested but the socket read failed
}

export const SAMPLE_INTERVAL_MS = 250;

// node:fs is looked up at call time instead of statically imported: integration
// modules are also bundled for the browser (WidgetRenderer registers them
// client-side), where fetchData is never invoked.
function getFs(): typeof import("node:fs") {
  if (typeof process === "undefined" || typeof process.getBuiltinModule !== "function") {
    throw new Error("System stats can only be read server-side");
  }
  return process.getBuiltinModule("node:fs");
}

/** Resolves after `ms`, or rejects immediately if `signal` aborts. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("System stats collection aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("System stats collection aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// --- Config resolution ---

export function resolveProcPath(config: SystemStatsConfig): string {
  return config.proc_path ?? process.env.KOKPIT_PROC_PATH ?? "/proc";
}

export function resolveDiskPath(config: SystemStatsConfig): string {
  return config.disk_path ?? "/";
}

export function resolveFields(config: SystemStatsConfig): SystemStatsField[] {
  const fields: readonly SystemStatsField[] = config.fields ?? DEFAULT_FIELDS;
  return [...new Set(fields)];
}

// --- Pure parsers / extractors (unit-tested directly, no fs) ---

export interface CpuSample {
  /** Sum of every jiffy column on the aggregate cpu line. */
  total: number;
  /** idle + iowait jiffies. */
  idle: number;
}

/** Parses the aggregate `cpu` line of /proc/stat into busy/idle jiffies. */
export function parseProcStat(text: string): CpuSample {
  const line = text.split("\n").find((l) => /^cpu\s/.test(l));
  if (!line) {
    throw new Error("No aggregate cpu line found in /proc/stat");
  }
  // Columns after "cpu": user nice system idle iowait irq softirq steal guest guest_nice
  const nums = line
    .trim()
    .split(/\s+/)
    .slice(1)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const idle = (nums[3] ?? 0) + (nums[4] ?? 0);
  const total = nums.reduce((sum, n) => sum + n, 0);
  return { total, idle };
}

/** Counts per-core `cpuN` lines in /proc/stat. */
export function countCores(statText: string): number {
  return statText.split("\n").filter((l) => /^cpu\d+\s/.test(l)).length;
}

/** CPU busy percentage (0-100) between two /proc/stat samples. */
export function cpuUsageFromSamples(prev: CpuSample, cur: CpuSample): number {
  const totalDelta = cur.total - prev.total;
  const idleDelta = cur.idle - prev.idle;
  if (totalDelta <= 0) return 0;
  const busy = totalDelta - idleDelta;
  return clamp((busy / totalDelta) * 100, 0, 100);
}

export interface MemSample {
  total: number; // bytes
  available: number; // bytes
}

/**
 * Parses /proc/meminfo. Uses MemAvailable when present; otherwise falls back to
 * MemFree + Buffers + Cached (so used = MemTotal - MemFree - Buffers - Cached).
 */
export function parseMeminfo(text: string): MemSample {
  const kb = new Map<string, number>();
  for (const line of text.split("\n")) {
    const m = /^(\w+):\s+(\d+)\s*kB/i.exec(line);
    if (m) kb.set(m[1], Number(m[2]));
  }
  const KB = 1024;
  const totalKb = kb.get("MemTotal") ?? 0;
  let availableKb = kb.get("MemAvailable");
  if (availableKb === undefined) {
    const free = kb.get("MemFree") ?? 0;
    const buffers = kb.get("Buffers") ?? 0;
    const cached = kb.get("Cached") ?? 0;
    availableKb = free + buffers + cached;
  }
  return { total: totalKb * KB, available: availableKb * KB };
}

export interface NetCounters {
  rx: number;
  tx: number;
}

/** Parses /proc/net/dev into per-interface received/transmitted byte counters. */
export function parseNetDev(text: string): Record<string, NetCounters> {
  const result: Record<string, NetCounters> = {};
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue; // header rows have no colon
    const iface = line.slice(0, colon).trim();
    if (!iface) continue;
    const nums = line
      .slice(colon + 1)
      .trim()
      .split(/\s+/)
      .map(Number);
    // rx bytes is column 0; tx bytes is column 8.
    if (nums.length < 9) continue;
    const rx = nums[0];
    const tx = nums[8];
    if (!Number.isFinite(rx) || !Number.isFinite(tx)) continue;
    result[iface] = { rx, tx };
  }
  return result;
}

export interface LoadSample {
  one: number;
  five: number;
  fifteen: number;
}

/** Parses the first three floats of /proc/loadavg. */
export function parseLoadAvg(text: string): LoadSample {
  const parts = text.trim().split(/\s+/);
  const num = (raw: string | undefined): number => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  };
  return { one: num(parts[0]), five: num(parts[1]), fifteen: num(parts[2]) };
}

/**
 * Byte-per-second rates between two /proc/net/dev samples. Skips `lo`, honours
 * an optional single-interface filter, sums the rest, and clamps negative
 * deltas (counter resets) to 0.
 */
export function netRatesFromSamples(
  prev: Record<string, NetCounters>,
  cur: Record<string, NetCounters>,
  elapsedSeconds: number,
  iface?: string
): { rxBytesPerSec: number; txBytesPerSec: number; interfaces: string[] } {
  const interfaces: string[] = [];
  let prevRx = 0;
  let prevTx = 0;
  let curRx = 0;
  let curTx = 0;
  for (const name of Object.keys(cur)) {
    if (name === "lo") continue;
    if (iface && name !== iface) continue;
    if (!(name in prev)) continue; // only measure interfaces present in both samples
    interfaces.push(name);
    prevRx += prev[name].rx;
    prevTx += prev[name].tx;
    curRx += cur[name].rx;
    curTx += cur[name].tx;
  }
  interfaces.sort();
  const rate = (later: number, earlier: number): number =>
    elapsedSeconds > 0 ? Math.max(0, (later - earlier) / elapsedSeconds) : 0;
  return {
    rxBytesPerSec: rate(curRx, prevRx),
    txBytesPerSec: rate(curTx, prevTx),
    interfaces,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// --- fs-backed reads ---

function joinProc(procPath: string, name: string): string {
  return `${procPath.replace(/\/+$/, "")}/${name}`;
}

async function readProcFile(
  procPath: string,
  name: string,
  signal?: AbortSignal
): Promise<string> {
  const full = joinProc(procPath, name);
  try {
    return await getFs().promises.readFile(full, { encoding: "utf-8", signal });
  } catch (err) {
    if (signal?.aborted) throw err; // propagate cancellation untouched
    throw new Error(
      `Cannot read ${full} — is this a Linux host? Mount the host /proc and set proc_path.`
    );
  }
}

async function readDiskStats(diskPath: string): Promise<import("node:fs").StatsFs> {
  try {
    return await getFs().promises.statfs(diskPath);
  } catch {
    throw new Error(
      `Cannot read filesystem stats for ${diskPath} — does the path exist and is it mounted?`
    );
  }
}

// --- Fetcher ---

export async function fetchSystemStats(
  config: SystemStatsConfig,
  signal?: AbortSignal
): Promise<SystemStatsData> {
  const fields = new Set(resolveFields(config));
  const procPath = resolveProcPath(config);
  const diskPath = resolveDiskPath(config);

  const data: SystemStatsData = {
    cpu: null,
    memory: null,
    disk: null,
    network: null,
    load: null,
    docker: null,
    dockerError: null,
  };

  // Only cpu and network require two samples separated by a fixed interval.
  const needSample = fields.has("cpu") || fields.has("network");
  let statText1: string | undefined;
  let netText1: string | undefined;
  let sampleStart = 0;
  if (needSample) {
    if (fields.has("cpu")) statText1 = await readProcFile(procPath, "stat", signal);
    if (fields.has("network")) netText1 = await readProcFile(procPath, "net/dev", signal);
    sampleStart = Date.now();
    await delay(SAMPLE_INTERVAL_MS, signal);
  }

  if (fields.has("cpu")) {
    const statText2 = await readProcFile(procPath, "stat", signal);
    const usagePercent = cpuUsageFromSamples(
      parseProcStat(statText1 as string),
      parseProcStat(statText2)
    );
    data.cpu = { usagePercent, cores: countCores(statText2) };
  }

  if (fields.has("memory")) {
    const { total, available } = parseMeminfo(
      await readProcFile(procPath, "meminfo", signal)
    );
    const used = total - available;
    data.memory = {
      total,
      used,
      available,
      usagePercent: total > 0 ? (used / total) * 100 : 0,
    };
  }

  if (fields.has("disk")) {
    const stats = await readDiskStats(diskPath);
    const total = stats.blocks * stats.bsize;
    const available = stats.bavail * stats.bsize;
    const used = (stats.blocks - stats.bfree) * stats.bsize;
    data.disk = {
      path: diskPath,
      total,
      used,
      available,
      usagePercent: total > 0 ? (used / total) * 100 : 0,
    };
  }

  if (fields.has("network")) {
    const netText2 = await readProcFile(procPath, "net/dev", signal);
    const elapsedSeconds = (Date.now() - sampleStart) / 1000;
    const { rxBytesPerSec, txBytesPerSec, interfaces } = netRatesFromSamples(
      parseNetDev(netText1 as string),
      parseNetDev(netText2),
      elapsedSeconds,
      config.interface
    );
    data.network = { rxBytesPerSec, txBytesPerSec, interfaces };
  }

  if (fields.has("load")) {
    const { one, five, fifteen } = parseLoadAvg(
      await readProcFile(procPath, "loadavg", signal)
    );
    // Reuse the core count from the cpu step when available; otherwise read stat.
    const cores =
      data.cpu?.cores ?? countCores(await readProcFile(procPath, "stat", signal));
    data.load = { one, five, fifteen, cores };
  }

  if (fields.has("docker")) {
    try {
      const dockerData = await fetchDockerData(
        { socket_path: config.docker_socket_path },
        signal
      );
      data.docker = { running: dockerData.running, total: dockerData.total };
    } catch (err) {
      // A Docker read failure degrades to a dockerError line — it must never
      // fail the whole widget.
      data.docker = null;
      data.dockerError = err instanceof Error ? err.message : String(err);
    }
  }

  return data;
}
