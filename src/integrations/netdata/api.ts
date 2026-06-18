import { z } from "zod";

export const NetdataBaseConfigSchema = z.object({
  url: z.string().url(),
  api_token: z.string().optional(),
  history_minutes: z.number().int().min(1).max(60).optional(),
});
export type NetdataBaseConfig = z.infer<typeof NetdataBaseConfigSchema>;

const DimensionSchema = z.object({ value: z.number().nullable() });

const ChartSchema = z.object({
  family: z.string().optional(),
  units: z.string().optional(),
  dimensions: z.record(z.string(), DimensionSchema),
});

const AllMetricsSchema = z.object({
  charts: z.record(z.string(), ChartSchema),
});

export type AllMetrics = z.infer<typeof AllMetricsSchema>;

export interface RawChartHistory {
  dimensionNames: string[];
  rows: number[][];
}

interface CacheEntry {
  data: AllMetrics;
  at: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 9_000;

function buildCacheKey(config: NetdataBaseConfig): string {
  return `${config.url}::${config.api_token ?? ""}`;
}

function buildUrl(base: string, path: string): string {
  const normalized = base.endsWith("/") ? base : base + "/";
  return new URL(path.replace(/^\/+/, ""), normalized).toString();
}

async function netdataFetch(
  config: NetdataBaseConfig,
  path: string,
  signal?: AbortSignal
): Promise<Response> {
  const url = buildUrl(config.url, path);
  const headers: Record<string, string> = {};
  if (config.api_token) {
    headers["X-Netdata-Auth"] = `Bearer ${config.api_token}`;
  }
  const res = await fetch(url, { headers, signal });
  if (!res.ok) throw new Error(`Netdata responded with ${res.status}`);
  return res;
}

export async function fetchAllMetrics(
  config: NetdataBaseConfig,
  signal?: AbortSignal
): Promise<AllMetrics> {
  const key = buildCacheKey(config);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data;

  const res = await netdataFetch(
    config,
    "api/v1/allmetrics?format=json&help=no",
    signal
  );
  const raw: unknown = await res.json();
  const data = AllMetricsSchema.parse(raw);
  cache.set(key, { data, at: Date.now() });
  return data;
}

export async function fetchChartHistory(
  config: NetdataBaseConfig,
  chartId: string,
  signal?: AbortSignal
): Promise<RawChartHistory> {
  const afterSecs = (config.history_minutes ?? 10) * 60;
  const path = `api/v1/data?chart=${encodeURIComponent(chartId)}&after=-${afterSecs}&points=60&format=json`;
  const res = await netdataFetch(config, path, signal);
  const raw = (await res.json()) as {
    dimension_names?: string[];
    data?: Array<[number, ...number[]]>;
  };
  const dimensionNames: string[] = raw.dimension_names ?? [];
  const rows: number[][] = (raw.data ?? []).map(([, ...rest]) => rest);
  return { dimensionNames, rows };
}

// --- Extractors ---

function dimValue(
  chart: AllMetrics["charts"][string],
  dimId: string
): number | null {
  return chart.dimensions[dimId]?.value ?? null;
}

function requireChart(metrics: AllMetrics, chartId: string) {
  const chart = metrics.charts[chartId];
  if (!chart) throw new Error(`Netdata chart "${chartId}" not found`);
  return chart;
}

export function extractCpu(metrics: AllMetrics): number {
  const chart = requireChart(metrics, "system.cpu");
  const idle = dimValue(chart, "idle") ?? 0;
  return Math.max(0, 100 - idle);
}

export function extractRam(
  metrics: AllMetrics
): { usedBytes: number; totalBytes: number } {
  const chart = requireChart(metrics, "system.ram");
  const MiB = 1024 * 1024;
  const free = (dimValue(chart, "free") ?? 0) * MiB;
  const used = (dimValue(chart, "used") ?? 0) * MiB;
  const cached = (dimValue(chart, "cached") ?? 0) * MiB;
  const buffers = (dimValue(chart, "buffers") ?? 0) * MiB;
  const total = free + used + cached + buffers;
  return { usedBytes: total - free, totalBytes: total };
}

export function extractNet(
  metrics: AllMetrics
): { inBps: number; outBps: number } {
  const chart = requireChart(metrics, "system.net");
  // system.net dimensions are in kilobits/s
  const received = Math.abs(dimValue(chart, "received") ?? 0);
  const sent = Math.abs(dimValue(chart, "sent") ?? 0);
  return {
    inBps: (received * 1000) / 8,
    outBps: (sent * 1000) / 8,
  };
}

export function extractDiskIo(
  metrics: AllMetrics
): { readBps: number; writeBps: number } {
  const chart = requireChart(metrics, "system.io");
  // system.io dimensions are in KiB/s
  const inVal = Math.abs(dimValue(chart, "in") ?? 0);
  const outVal = Math.abs(dimValue(chart, "out") ?? 0);
  return { readBps: inVal * 1024, writeBps: outVal * 1024 };
}

export function extractDiskSpace(
  metrics: AllMetrics,
  chartId = "disk_space._"
): { usedBytes: number; totalBytes: number } {
  const chart = requireChart(metrics, chartId);
  // disk_space dimensions are in GiB
  const GiB = 1024 * 1024 * 1024;
  const avail = (dimValue(chart, "avail") ?? 0) * GiB;
  const used = (dimValue(chart, "used") ?? 0) * GiB;
  const reserved = (dimValue(chart, "reserved_for_root") ?? 0) * GiB;
  return { usedBytes: used, totalBytes: avail + used + reserved };
}

export function extractLoad(
  metrics: AllMetrics
): { one: number; five: number; fifteen: number } {
  const chart = requireChart(metrics, "system.load");
  return {
    one: dimValue(chart, "load1") ?? 0,
    five: dimValue(chart, "load5") ?? 0,
    fifteen: dimValue(chart, "load15") ?? 0,
  };
}

export function extractSensor(
  metrics: AllMetrics,
  chartId: string
): { value: number; units: string } | null {
  const chart = metrics.charts[chartId];
  if (!chart) return null;
  const vals = Object.values(chart.dimensions)
    .map((d) => d.value)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (vals.length === 0) return null;
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  return { value: avg, units: chart.units ?? "" };
}
