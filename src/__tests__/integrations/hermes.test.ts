// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { HermesConfigSchema, fetchHermes } from "@/integrations/hermes/api";
import { fetchOverview } from "@/integrations/hermes/server";
import { ssrfSafeFetch, SsrfBlockedError } from "@/lib/ssrfGuard";
import { getIntegration, getWidget } from "@/widgets";
import { splitWidgetConfig } from "@/widgets/configBoundary";
import { toClientSafeSettings } from "@/widgets/configSecrets";
import { KokpitConfigSchema } from "@/config/schema";
import "@/integrations/hermes/widget";

vi.mock("@/lib/ssrfGuard", () => ({ ssrfSafeFetch: vi.fn(), SsrfBlockedError: class extends Error {} }));
const config = { url: "http://hermes:8642/p/work", api_key: "hermes-secret" };
const health = { status: "ok", readiness: { status: "ok" }, api_server: { active_runs: 2 }, private: "never forward" };
const jobs = { jobs: [
  { name: "Later", enabled: true, next_run_at: "2026-10-21T12:00:00Z", last_status: "ok", prompt: "private prompt" },
  { name: "Next", enabled: true, next_run_at: "2026-10-20T12:00:00Z", last_status: "error", last_error: "secret" },
  { name: "Paused", enabled: false, next_run_at: "2026-10-19T12:00:00Z" },
  { name: "Pause marker", enabled: true, state: "paused", next_run_at: "2026-10-19T12:00:00Z" },
] };
const sessions = { data: [
  { id: "s1", title: "Old session", source: "telegram", started_at: 1720000000, last_active: null, preview: "private preview" },
  { id: "s2", title: null, source: "cli", last_active: "2026-10-20T11:00:00Z" },
] };
function mock(overrides: Record<string, unknown | Response | Error> = {}) {
  return vi.mocked(ssrfSafeFetch).mockImplementation(async (url) => {
    const path = new URL(url).pathname.replace("/p/work/", "");
    const data = Object.hasOwn(overrides, path) ? overrides[path] : ({ "health/detailed": health, "health": { status: "ok" }, "api/jobs": jobs, "api/sessions": sessions } as Record<string, unknown>)[path];
    if (data instanceof Error) throw data;
    return data instanceof Response ? data : Response.json(data);
  });
}
afterEach(() => vi.resetAllMocks());

describe("Hermes overview", () => {
  it("uses the API/profile prefix, bearer authentication, pinned LAN access and no redirects", async () => {
    const fetch = mock(); const signal = new AbortController().signal;
    const data = await fetchHermes(config, signal);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenCalledWith("http://hermes:8642/p/work/health/detailed", expect.objectContaining({ signal, allowPrivateNetworks: true, followRedirects: false, headers: { Authorization: "Bearer hermes-secret", Accept: "application/json" } }));
    expect(fetch).toHaveBeenCalledWith("http://hermes:8642/p/work/api/sessions?limit=10&offset=0&include_children=false", expect.anything());
    expect(data).toMatchObject({ health: "ready", activeApiRuns: 2, scheduledJobs: 2, failedJobs: 1, nextJob: { name: "Next", nextRun: "2026-10-20T12:00:00.000Z", lastStatus: "error" } });
    expect(data.sessions.map(s => s.id)).toEqual(["s2", "s1"]);
    expect(data.sessions[0].title).toBe("Untitled session");
    expect(data.sessions[1].lastActive).toBe(new Date(1720000000 * 1000).toISOString());
    expect(JSON.stringify(data)).not.toMatch(/private|secret|preview|prompt/);
  });
  it("preserves trailing slashes, zero counts and explicit degraded readiness", async () => {
    mock({ "health/detailed": { status: "degraded", readiness: { status: "degraded" }, api_server: { active_runs: 0 } }, "api/jobs": { jobs: [] }, "api/sessions": { data: [] } });
    expect(await fetchOverview({ ...config, url: config.url + "/" })).toMatchObject({ health: "degraded", activeApiRuns: 0, scheduledJobs: 0, failedJobs: 0, nextJob: null, sessions: [] });
  });
  it.each([0, 3])("prefers the readiness background-queue count, including %s active API runs", async count => {
    mock({ "health/detailed": { ...health, readiness: { status: "ok", checks: { background_queues: { active_api_runs: count } } } } });
    expect(await fetchOverview(config)).toMatchObject({ activeApiRuns: count });
  });
  it.each([null, { background_queues: null }, { background_queues: { active_api_runs: 1.5 } }, { background_queues: { active_api_runs: "2" } }, { background_queues: { active_api_runs: -1 } }, { background_queues: [] }])("retains readiness when optional diagnostic counts are malformed: %j", async checks => {
    mock({ "health/detailed": { status: "ok", readiness: { status: "ok", checks }, api_server: null } });
    expect(await fetchOverview(config)).toMatchObject({ health: "ready", activeApiRuns: null });
  });
  it("falls back to liveness for older versions and distinguishes unsupported sections from empty ones", async () => {
    mock({ "health/detailed": new Response(null, { status: 404 }), "api/jobs": new Response(null, { status: 501 }), "api/sessions": new Response(null, { status: 404 }) });
    expect(await fetchOverview(config)).toEqual({ health: "online", activeApiRuns: null, scheduledJobs: null, failedJobs: null, nextJob: null, jobsState: "unsupported", sessionsState: "unsupported", sessions: [] });
  });
  it("does not invent missing counters or readiness for an unknown health status", async () => {
    mock({ "health/detailed": { status: "maintenance" } });
    expect(await fetchOverview(config)).toMatchObject({ health: "unknown", activeApiRuns: null });
  });
  it.each(["api/jobs", "api/sessions"])("reports optional %s failures without hiding health or displaying zero", async path => {
    mock({ [path]: new Response(null, { status: 503 }) }); const data = await fetchOverview(config);
    expect(data.health).toBe("ready");
    expect(path === "api/jobs" ? data.jobsState : data.sessionsState).toBe("unavailable");
    if (path === "api/jobs") { expect(data.scheduledJobs).toBeNull(); expect(data.failedJobs).toBeNull(); }
  });
  it.each([401, 403])("fails authentication even when only an optional section returns %s", async status => {
    mock({ "api/jobs": new Response(null, { status }) });
    await expect(fetchOverview(config)).rejects.toMatchObject({ code: "widget_upstream_auth_failed" });
  });
  it("marks rate-limited health requests as retryable", async () => {
    mock({ "health/detailed": new Response(null, { status: 429 }) });
    await expect(fetchOverview(config)).rejects.toMatchObject({ code: "widget_upstream_error", diagnostic: { upstreamStatus: 429, retryable: true } });
  });
  it.each([401, 503])("preserves HTTP %s classification when body cleanup rejects", async status => {
    const body = new ReadableStream({ cancel() { throw new Error("private cleanup detail"); } });
    mock({ "api/jobs": new Response(body, { status }) });
    if (status === 401) await expect(fetchOverview(config)).rejects.toMatchObject({ code: "widget_upstream_auth_failed" });
    else expect(await fetchOverview(config)).toMatchObject({ health: "ready", jobsState: "unavailable", scheduledJobs: null });
  });
  it("counts paused jobs only when their last result failed, including delivery failures", async () => {
    mock({ "api/jobs": { jobs: [
      { name: "Paused after failure", enabled: false, state: "paused", last_status: "error" },
      { name: "Paused after success", enabled: false, state: "paused", last_status: "ok" },
      { name: "Delivery failure", enabled: true, last_status: "delivery_failed" },
    ] } });
    expect(await fetchOverview(config)).toMatchObject({ scheduledJobs: 1, failedJobs: 2 });
  });
  it("excludes terminal and running jobs from upcoming work and includes configuration and scheduling failures", async () => {
    mock({ "api/jobs": { jobs: [
      { name: "Schedule failure", enabled: true, state: "error", last_status: "ok", next_run_at: "2026-10-19T00:00:00Z" },
      { name: "Completed", enabled: true, state: "completed", next_run_at: "2026-10-19T00:00:00Z" },
      { name: "Running", enabled: true, state: "running", next_run_at: "2026-10-18T00:00:00Z", last_status: "ok" },
      { name: "Awaiting repair", enabled: true, state: "scheduled", last_status: "blocked_config", next_run_at: "2026-10-21T00:00:00Z" },
    ] } });
    expect(await fetchOverview(config)).toMatchObject({ scheduledJobs: 1, failedJobs: 2, nextJob: { name: "Awaiting repair" } });
  });
  it("rejects redirects without sending credentials to another destination", async () => {
    const fetch = mock({ "health/detailed": new Response(null, { status: 302, headers: { Location: "http://other/private" } }) });
    await expect(fetchOverview(config)).rejects.toMatchObject({ code: "widget_upstream_error" }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([new Error("secret url"), new SsrfBlockedError("metadata")])("classifies network and destination failures safely", async error => {
    mock({ "health/detailed": error });
    await expect(fetchOverview(config)).rejects.toMatchObject({ code: error instanceof SsrfBlockedError ? "widget_upstream_access_blocked" : "widget_upstream_unreachable", message: "Widget integration failure" });
  });
  it("propagates cancellation and never turns it into an optional-section success", async () => {
    const controller = new AbortController(); controller.abort(); const fetch = mock();
    await expect(fetchOverview(config, controller.signal)).rejects.toMatchObject({ name: "AbortError" }); expect(fetch).not.toHaveBeenCalled();
    mock({ "api/sessions": new DOMException("aborted", "AbortError") });
    await expect(fetchOverview(config)).rejects.toMatchObject({ name: "AbortError" });
  });
  it("rejects malformed or oversized health payloads", async () => {
    mock({ "health/detailed": new Response("not json") });
    await expect(fetchOverview(config)).rejects.toMatchObject({ code: "widget_invalid_json" });
    mock({ "health/detailed": { status: 42 } });
    await expect(fetchOverview(config)).rejects.toMatchObject({ code: "widget_invalid_response" });
    mock({ "health/detailed": new Response("x".repeat(1024 * 1024 + 1)) });
    await expect(fetchOverview(config)).rejects.toMatchObject({ code: "widget_invalid_response", diagnostic: { stage: "size" } });
  });
  it("keeps malformed optional payloads visibly unavailable", async () => {
    mock({ "api/jobs": { jobs: [{ enabled: "yes" }] }, "api/sessions": { data: "broken" } });
    expect(await fetchOverview(config)).toMatchObject({ jobsState: "unavailable", sessionsState: "unavailable", scheduledJobs: null });
  });
  it("bounds recent sessions and titles, and does not infer future runs from invalid dates", async () => {
    mock({ "api/jobs": { jobs: [{ name: "Undated", next_run_at: "broken" }] }, "api/sessions": { data: Array.from({ length: 15 }, (_, i) => ({ id: String(i), title: "x".repeat(300), source: "api_server", last_active: 1e100 })) } });
    const data = await fetchOverview(config); expect(data.nextJob).toBeNull(); expect(data.sessions).toHaveLength(10); expect(data.sessions[0].title).toHaveLength(200); expect(data.sessions[0].lastActive).toBeNull();
  });
  it.each(["file:///etc/passwd", "http://user:password@hermes/", "http://hermes/?key=secret", "http://hermes/#fragment"])("rejects unsafe connection URL %s before fetching", async url => {
    const fetch = mock(); await expect(fetchOverview({ ...config, url })).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Hermes configuration", () => {
  it("registers a reusable destination-scoped integration with precisely 3×4 and 6×3 canvases", () => {
    expect(HermesConfigSchema.safeParse({ ...config, api_key: "bad\nkey" }).success).toBe(false);
    expect(getIntegration("hermes")?.credentialScopeFields).toEqual(["url"]);
    const widget = getWidget("hermes-overview")!;
    expect(widget.supportedFootprints?.map(f => [f.columnSpan, f.rowSpan])).toEqual([[3, 4], [6, 3]]);
    expect(widget.sharedUI).toBe(true); expect(widget.refreshInterval).toBe(30_000);
    expect(splitWidgetConfig(widget.id, config)).toEqual({ connection: config, options: {} });
  });
  it("redacts the API key in browser settings while retaining an opaque saved connection", () => {
    const saved = KokpitConfigSchema.parse({ schema_version: 2, services: [{ id: "10000000-0000-4000-8000-000000000001", name: "Hermes", integration: { type: "hermes", config } }], service_tiles: [{ id: "20000000-0000-4000-8000-000000000001", service_id: "10000000-0000-4000-8000-000000000001", widget: { type: "hermes-overview" } }] });
    const redacted = toClientSafeSettings(saved);
    expect(JSON.stringify(redacted)).not.toContain("hermes-secret");
    expect(saved.services[0].integration?.config.api_key).toBe("hermes-secret");
  });
});
