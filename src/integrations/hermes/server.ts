import { z } from "zod";
import { ssrfSafeFetch, SsrfBlockedError } from "@/lib/ssrfGuard";
import { WidgetFetchError } from "@/widgets/publicFetchError";
import { HermesConfigSchema, type HermesConfig, type HermesData, type HermesSectionState } from "./api";

const MAX_BYTES = 1024 * 1024;
const Count = z.number().int().nonnegative().nullable().optional();
const Health = z.object({
  status: z.string(),
  readiness: z.object({
    status: z.string(),
    checks: z.object({ background_queues: z.object({ active_api_runs: Count }).optional() }).optional(),
  }).optional(),
  api_server: z.object({ active_runs: Count }).optional(),
});
const Timestamp = z.union([z.string(), z.number()]).nullable().optional();
const Sessions = z.object({ data: z.array(z.object({
  id: z.string().min(1), title: z.string().nullable().optional(), source: z.string().nullable().optional(),
  last_active: Timestamp, started_at: Timestamp,
})) });
const Jobs = z.object({ jobs: z.array(z.object({
  name: z.string().nullable().optional(), enabled: z.boolean().optional(),
  state: z.string().nullable().optional(), paused_at: Timestamp,
  next_run_at: Timestamp, last_status: z.string().nullable().optional(),
})) });

function failure(code: ConstructorParameters<typeof WidgetFetchError>[0], stage: string, status?: number) {
  return new WidgetFetchError(code, { integration: "hermes", stage, upstreamStatus: status, retryable: code === "widget_upstream_unreachable" || status === 429 || (status !== undefined && status >= 500) });
}
function cancelled(signal?: AbortSignal) { signal?.throwIfAborted(); }

/** Project metadata only: prompts, transcripts, errors and credentials never reach the browser. */
async function request(config: HermesConfig, path: string, signal?: AbortSignal): Promise<{ status: number; data: unknown }> {
  const base = config.url.endsWith("/") ? config.url : `${config.url}/`;
  let response: Response;
  try {
    response = await ssrfSafeFetch(new URL(path, base).href, {
      headers: { Authorization: `Bearer ${config.api_key}`, Accept: "application/json" },
      allowPrivateNetworks: true, followRedirects: false, signal,
    });
  } catch (error) {
    cancelled(signal);
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw failure(error instanceof SsrfBlockedError ? "widget_upstream_access_blocked" : "widget_upstream_unreachable", "connect");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) throw failure("widget_upstream_auth_failed", "authenticate", response.status);
    return { status: response.status, data: null };
  }
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw failure("widget_invalid_response", "size");
  }
  const reader = response.body?.getReader();
  if (!reader) throw failure("widget_invalid_response", "body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw failure("widget_invalid_response", "size");
      chunks.push(value);
    }
  } catch (error) {
    cancelled(signal);
    if (error instanceof WidgetFetchError || (error instanceof Error && error.name === "AbortError")) throw error;
    throw failure("widget_upstream_unreachable", "body");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { status: response.status, data: JSON.parse(new TextDecoder().decode(bytes)) }; }
  catch { throw failure("widget_invalid_json", "json"); }
}

async function section<T>(config: HermesConfig, path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<{ state: HermesSectionState; data: T | null }> {
  try {
    const response = await request(config, path, signal);
    if ([404, 405, 501].includes(response.status)) return { state: "unsupported", data: null };
    if (response.status !== 200) return { state: "unavailable", data: null };
    const parsed = schema.safeParse(response.data);
    return parsed.success ? { state: "available", data: parsed.data } : { state: "unavailable", data: null };
  } catch (error) {
    cancelled(signal);
    if (error instanceof WidgetFetchError && error.code !== "widget_upstream_auth_failed" && error.code !== "widget_upstream_access_blocked") return { state: "unavailable", data: null };
    throw error;
  }
}

function date(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  // Hermes session storage uses Unix seconds; cron uses RFC3339 strings.
  const ms = typeof value === "number" ? value * 1000 : Date.parse(value);
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : null;
}
const text = (value: string | null | undefined, fallback: string) => value?.trim().slice(0, 200) || fallback;

export async function fetchOverview(rawConfig: HermesConfig, signal?: AbortSignal): Promise<HermesData> {
  const config = HermesConfigSchema.parse(rawConfig);
  cancelled(signal);
  let health = await request(config, "health/detailed", signal);
  const detailed = ![404, 405, 501].includes(health.status);
  if (!detailed) health = await request(config, "health", signal);
  if (health.status !== 200) throw failure("widget_upstream_error", "health", health.status);
  const parsed = Health.safeParse(health.data);
  if (!parsed.success) throw failure("widget_invalid_response", "health");
  const status = parsed.data.readiness?.status ?? parsed.data.status;
  const [jobs, sessions] = await Promise.all([
    section(config, "api/jobs?include_disabled=true", Jobs, signal),
    section(config, "api/sessions?limit=10&offset=0&include_children=false", Sessions, signal),
  ]);
  const allJobs = jobs.data?.jobs ?? [];
  const scheduled = allJobs.filter(job => job.enabled !== false && !["paused", "completed", "error"].includes(job.state ?? "") && !job.paused_at);
  const next = scheduled.map(job => ({ name: text(job.name, "Unnamed job"), nextRun: date(job.next_run_at), lastStatus: job.last_status?.slice(0, 40) ?? null }))
    .filter((job): job is { name: string; nextRun: string; lastStatus: string | null } => job.nextRun !== null)
    .sort((a, b) => a.nextRun.localeCompare(b.nextRun))[0] ?? null;
  const recent = (sessions.data?.data ?? []).map(session => ({
    id: session.id, title: text(session.title, "Untitled session"), source: text(session.source, "Unknown source"),
    lastActive: date(session.last_active) ?? date(session.started_at),
  })).sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));
  return {
    health: status === "ok" ? parsed.data.readiness?.status === "ok" ? "ready" : "online" : status === "degraded" ? "degraded" : "unknown",
    activeApiRuns: detailed ? parsed.data.readiness?.checks?.background_queues?.active_api_runs ?? parsed.data.api_server?.active_runs ?? null : null,
    jobsState: jobs.state, scheduledJobs: jobs.data ? scheduled.length : null,
    failedJobs: jobs.data ? allJobs.filter(job => job.state === "error" || ["error", "failed", "delivery_failed", "blocked_config"].includes(job.last_status ?? "")).length : null,
    nextJob: next, sessionsState: sessions.state, sessions: recent.slice(0, 10),
  };
}
