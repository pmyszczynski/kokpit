// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("proper-lockfile", () => ({ lockSync: vi.fn(() => () => undefined) }));
vi.mock("node:fs", () => {
  const readFileSync = vi.fn();
  const existsSync = vi.fn((path?: unknown) => !String(path ?? "").includes("settings.yaml.displaced"));
  return { default: { readFileSync, existsSync }, readFileSync, existsSync, writeFileSync: vi.fn(), linkSync: vi.fn(), unlinkSync: vi.fn(), mkdirSync: vi.fn(), renameSync: vi.fn(), statSync: vi.fn().mockReturnValue({ mode: 0o100644 }), chmodSync: vi.fn() };
});
vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue({ get: () => undefined }) }));
const ssrfSafeFetchMock = vi.fn();
vi.mock("@/lib/ssrfGuard", () => ({ ssrfSafeFetch: (...args: unknown[]) => ssrfSafeFetchMock(...args) }));

import { existsSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const SERVICE_ID = "10000000-0000-4000-8000-000000000001";
const LAN_SERVICE_ID = "10000000-0000-4000-8000-000000000002";
const BASE_YAML = `schema_version: 2
auth: { enabled: false, session_ttl_hours: 24 }
appearance: { theme: dark }
layout: {}
services:
  - id: ${SERVICE_ID}
    name: Public
    launch_url: https://public.example/status
  - id: ${LAN_SERVICE_ID}
    name: LAN
    launch_url: http://192.168.1.10:8080
service_tiles: []`;
const AUTH_ENABLED_YAML = BASE_YAML.replace("enabled: false", "enabled: true");

function servicesYaml(count: number): string {
  return `schema_version: 2
auth: { enabled: false, session_ttl_hours: 24 }
appearance: { theme: dark }
layout: {}
services:
${Array.from({ length: count }, (_, index) => `  - id: 10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}
    name: Service ${index + 1}
    launch_url: https://service-${index + 1}.example`).join("\n")}
service_tiles: []`;
}

function upstreamResponse(status: number, cancel = vi.fn().mockResolvedValue(undefined)): Response {
  return { status, body: { cancel } } as unknown as Response;
}

function post(body: unknown, contentType = "application/json") {
  return new Request("http://localhost/api/ping", { method: "POST", headers: { "Content-Type": contentType }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

function chunkedPost(chunks: string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Request("http://localhost/api/ping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: stream as unknown as BodyInit,
    duplex: "half",
  } as RequestInit);
}

describe("POST /api/ping", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    ssrfSafeFetchMock.mockReset();
    vi.stubEnv("KOKPIT_AUTH_DISABLED", "true");
    vi.mocked(existsSync).mockImplementation((path?: unknown) => !String(path ?? "").includes("settings.yaml.displaced"));
    vi.mocked(readFileSync).mockReturnValue(BASE_YAML);
    const { invalidateCache } = await import("@/config/loader");
    invalidateCache();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("accepts only JSON POST bodies with a service ID", async () => {
    const { POST } = await import("../../app/api/ping/route");
    expect((await POST(post({ serviceId: SERVICE_ID }, "text/plain"))).status).toBe(415);
    expect((await POST(post("not json"))).status).toBe(400);
    expect((await POST(post({}))).status).toBe(400);
    expect((await POST(post({ serviceId: "not-a-uuid" }))).status).toBe(400);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized declared and chunked JSON bodies before probing", async () => {
    const { POST } = await import("../../app/api/ping/route");
    const declared = new Request("http://localhost/api/ping", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "1025" },
      body: "{}",
    });
    expect((await POST(declared)).status).toBe(413);
    expect((await POST(chunkedPost(["{\"serviceId\":\"", "x".repeat(1024)]))).status).toBe(413);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("resolves the saved service URL instead of accepting a caller target", async () => {
    ssrfSafeFetchMock.mockResolvedValue(upstreamResponse(200));
    const { POST } = await import("../../app/api/ping/route");
    const res = await POST(post({ serviceId: SERVICE_ID, url: "http://169.254.169.254/latest/meta-data/" }));
    expect(await res.json()).toMatchObject({ ok: true, status: 200 });
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith("https://public.example/status", expect.objectContaining({ method: "HEAD", allowPrivateNetworks: true, followRedirects: false }));
  });

  it("reports any HTTP response as reachable and permits saved LAN services", async () => {
    ssrfSafeFetchMock.mockResolvedValueOnce(upstreamResponse(404)).mockResolvedValueOnce(upstreamResponse(503));
    const { POST } = await import("../../app/api/ping/route");
    expect(await (await POST(post({ serviceId: SERVICE_ID }))).json()).toMatchObject({ ok: true, status: 404 });
    expect(await (await POST(post({ serviceId: LAN_SERVICE_ID }))).json()).toMatchObject({ ok: true, status: 503 });
    expect(ssrfSafeFetchMock.mock.calls.map(([url]) => url)).toEqual(["https://public.example/status", "http://192.168.1.10:8080/"]);
  });

  it("rejects unknown or invalid saved services without a network call", async () => {
    const { POST } = await import("../../app/api/ping/route");
    expect((await POST(post({ serviceId: "20000000-0000-4000-8000-000000000001" }))).status).toBe(404);
    vi.mocked(readFileSync).mockReturnValue(BASE_YAML.replace("https://public.example/status", "ftp://public.example/file"));
    const { invalidateCache } = await import("@/config/loader");
    invalidateCache();
    expect((await POST(post({ serviceId: SERVICE_ID }))).status).toBe(400);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("treats a 405 HEAD response as reachable and cancels its body", async () => {
    const headCancel = vi.fn().mockResolvedValue(undefined);
    ssrfSafeFetchMock.mockResolvedValueOnce(upstreamResponse(405, headCancel));
    const { POST } = await import("../../app/api/ping/route");
    expect(await (await POST(post({ serviceId: SERVICE_ID }))).json()).toMatchObject({ ok: true, status: 405 });
    expect(ssrfSafeFetchMock.mock.calls.map(([, options]) => options.method)).toEqual(["HEAD"]);
    expect(headCancel).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent requests and briefly reuses the completed result", async () => {
    let resolveUpstream!: (response: Response) => void;
    ssrfSafeFetchMock.mockImplementation(() => new Promise<Response>((resolve) => { resolveUpstream = resolve; }));
    const { POST } = await import("../../app/api/ping/route");
    const first = POST(post({ serviceId: SERVICE_ID }));
    const second = POST(post({ serviceId: SERVICE_ID }));
    await vi.waitFor(() => expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1));
    resolveUpstream(upstreamResponse(200));
    expect(await (await first).json()).toMatchObject({ ok: true, status: 200 });
    expect(await (await second).json()).toMatchObject({ ok: true, status: 200 });
    expect(await (await POST(post({ serviceId: SERVICE_ID }))).json()).toMatchObject({ ok: true, status: 200 });
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes the probe after the cooldown expires", async () => {
    vi.useFakeTimers();
    ssrfSafeFetchMock.mockResolvedValueOnce(upstreamResponse(200)).mockResolvedValueOnce(upstreamResponse(204));
    const { POST } = await import("../../app/api/ping/route");
    expect(await (await POST(post({ serviceId: SERVICE_ID }))).json()).toMatchObject({ ok: true, status: 200 });
    await vi.advanceTimersByTimeAsync(3_001);
    expect(await (await POST(post({ serviceId: SERVICE_ID }))).json()).toMatchObject({ ok: true, status: 204 });
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(2);
  });

  it("retains pending probes and rejects new work at the pending limit", async () => {
    vi.mocked(readFileSync).mockReturnValue(servicesYaml(101));
    const { invalidateCache } = await import("@/config/loader");
    invalidateCache();
    const resolvers: ((response: Response) => void)[] = [];
    ssrfSafeFetchMock.mockImplementation(() => new Promise<Response>((resolve) => resolvers.push(resolve)));
    const { POST } = await import("../../app/api/ping/route");
    const ids = Array.from({ length: 101 }, (_, index) =>
      `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    );
    const pending = ids.slice(0, 100).map((serviceId) => POST(post({ serviceId })));
    await vi.waitFor(() => expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(100));
    const repeatedOldest = POST(post({ serviceId: ids[0] }));
    await Promise.resolve();
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(100);
    expect(await (await POST(post({ serviceId: ids[100] }))).json()).toMatchObject({ ok: false, reachable: null, assessment: "unavailable", reason: "capacity", responseTimeMs: null });
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(100);

    resolvers[0](upstreamResponse(200));
    expect(await (await pending[0]).json()).toMatchObject({ ok: true, status: 200 });
    expect(await (await repeatedOldest).json()).toMatchObject({ ok: true, status: 200 });
    const next = POST(post({ serviceId: ids[100] }));
    await vi.waitFor(() => expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(101));
    resolvers[100](upstreamResponse(200));
    expect(await (await next).json()).toMatchObject({ ok: true, status: 200 });
  });

  it("returns a bounded failure when the guarded request fails", async () => {
    ssrfSafeFetchMock.mockRejectedValue(new Error("upstream secret details"));
    const { POST } = await import("../../app/api/ping/route");
    expect(await (await POST(post({ serviceId: SERVICE_ID }))).json()).toMatchObject({ ok: false });
  });

  it.each([
    [200, "reachable"], [204, "reachable"], [302, "redirect"], [401, "authentication-required"],
    [403, "access-restricted"], [404, "http-error"], [405, "method-unsupported"],
    [500, "degraded"], [501, "method-unsupported"], [503, "degraded"],
  ])("classifies observed HTTP %i as %s without redirect following, credentials, or GET fallback", async (status, assessment) => {
    ssrfSafeFetchMock.mockResolvedValue(upstreamResponse(status as number));
    const { POST } = await import("../../app/api/ping/route");
    const result = await (await POST(post({ serviceId: SERVICE_ID }))).json();
    expect(result).toMatchObject({ ok: true, reachable: true, status, assessment, checkedAt: expect.any(Number), responseTimeMs: expect.any(Number) });
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1);
    const options = ssrfSafeFetchMock.mock.calls[0][1];
    expect(options).toMatchObject({ method: "HEAD", followRedirects: false, allowPrivateNetworks: true });
    expect(options.headers).toBeUndefined();
    expect(options.body).toBeUndefined();
  });

  it("retains the original monotonic header latency and observation timestamp when reusing a probe", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    const clock = vi.spyOn(performance, "now").mockReturnValue(100);
    let resolveUpstream!: (response: Response) => void;
    ssrfSafeFetchMock.mockReturnValue(new Promise<Response>(resolve => { resolveUpstream = resolve; }));
    const { POST } = await import("../../app/api/ping/route");
    const first = POST(post({ serviceId: SERVICE_ID }));
    await vi.waitFor(() => expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1));
    clock.mockReturnValue(142.25);
    resolveUpstream(upstreamResponse(200));
    const result = await (await first).json();
    expect(result.responseTimeMs).toBe(42.3);
    await vi.advanceTimersByTimeAsync(1000);
    const reused = await (await POST(post({ serviceId: SERVICE_ID }))).json();
    expect(reused).toEqual(result);
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps an observed response even if discarded-body cancellation never settles", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    ssrfSafeFetchMock.mockResolvedValue(upstreamResponse(405, cancel));
    const { POST } = await import("../../app/api/ping/route");
    const result = await (await POST(post({ serviceId: SERVICE_ID }))).json();
    expect(result).toMatchObject({ ok: true, reachable: true, status: 405, assessment: "method-unsupported" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    [Object.assign(new Error("sensitive URL or token"), { code: "ECONNREFUSED" }), "unreachable", "connection-failed"],
    [Object.assign(new Error("sensitive socket details"), { code: "EPIPE" }), "unreachable", "connection-failed"],
    [Object.assign(new Error("sensitive socket details"), { code: "ECONNABORTED" }), "unreachable", "connection-failed"],
    [Object.assign(new Error("sensitive network details"), { code: "ENETDOWN" }), "unreachable", "connection-failed"],
    [Object.assign(new Error("sensitive network details"), { code: "ENETRESET" }), "unreachable", "connection-failed"],
    [Object.assign(new Error("sensitive host details"), { code: "EHOSTDOWN" }), "unreachable", "connection-failed"],
    [Object.assign(new Error("sensitive socket details"), { code: "ERR_SOCKET_CLOSED" }), "unreachable", "connection-failed"],
    [Object.assign(new Error("sensitive socket details"), { code: "ERR_SOCKET_CONNECTION_TIMEOUT" }), "unreachable", "connection-failed"],
    [new TypeError("sensitive request details", { cause: new Error("sensitive wrapper", { cause: { code: "EPIPE" } }) }), "unreachable", "connection-failed"],
    [new TypeError("sensitive TLS details", { cause: { code: "CERT_HAS_EXPIRED" } }), "unreachable", "connection-failed"],
    [Object.assign(new Error("sensitive host"), { name: "SsrfBlockedError", reason: "dns-failed" }), "unreachable", "dns-failed"],
    [Object.assign(new Error("sensitive resolver details"), { name: "SsrfBlockedError", reason: "dns-unavailable", code: "ECONNREFUSED" }), "unavailable", "checker-failed"],
    [Object.assign(new Error("sensitive host"), { name: "SsrfBlockedError", reason: "blocked" }), "unavailable", "probe-blocked"],
    [Object.assign(new Error("sensitive resolver details"), { code: "EAI_AGAIN" }), "unavailable", "checker-failed"],
    [new TypeError("sensitive programming details", { cause: { code: "ERR_INVALID_ARG_TYPE" } }), "unavailable", "checker-failed"],
    [Object.assign(new RangeError("sensitive bad port"), { code: "ERR_SOCKET_BAD_PORT" }), "unavailable", "checker-failed"],
    [new Error("sensitive internal details"), "unavailable", "checker-failed"],
  ])("separates transport observations from local checker failures without exposing raw errors %#", async (error, assessment, reason) => {
    ssrfSafeFetchMock.mockRejectedValue(error);
    const { POST } = await import("../../app/api/ping/route");
    const result = await (await POST(post({ serviceId: SERVICE_ID }))).json();
    expect(result).toMatchObject({ ok: false, assessment, reason, reachable: assessment === "unreachable" ? false : null });
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });

  it("bounds cyclic error causes and keeps programming failures neutral", async () => {
    const error = new TypeError("sensitive programming failure");
    error.cause = error;
    ssrfSafeFetchMock.mockRejectedValue(error);
    const { POST } = await import("../../app/api/ping/route");
    const result = await (await POST(post({ serviceId: SERVICE_ID }))).json();
    expect(result).toMatchObject({ ok: false, reachable: null, assessment: "unavailable", reason: "checker-failed" });
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });

  it("bounds a non-cooperative probe timeout and cancels its own upstream signal", async () => {
    vi.useFakeTimers();
    const clock = vi.spyOn(performance, "now").mockReturnValue(100);
    ssrfSafeFetchMock.mockReturnValue(new Promise(() => {}));
    const { POST } = await import("../../app/api/ping/route");
    const pending = POST(post({ serviceId: SERVICE_ID }));
    await vi.waitFor(() => expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1));
    clock.mockReturnValue(5100);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await (await pending).json()).toMatchObject({ ok: false, reachable: false, assessment: "unreachable", reason: "timeout", responseTimeMs: 5000 });
    expect(ssrfSafeFetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("does not start a previous destination when initial authorization yields across a source change", async () => {
    vi.doMock("@/auth", () => ({
      isRequestAuthenticated: vi.fn(async () => {
        vi.mocked(readFileSync).mockReturnValue(BASE_YAML.replace("https://public.example/status", "https://replacement.example/health"));
        return true;
      }),
    }));
    try {
      const { POST } = await import("../../app/api/ping/route");
      expect((await POST(post({ serviceId: SERVICE_ID }))).status).toBe(409);
      expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
    } finally { vi.doUnmock("@/auth"); }
  });

  it("does not return a previous destination after configuration changes during a probe", async () => {
    let resolveOld!: (response: Response) => void;
    ssrfSafeFetchMock.mockReturnValueOnce(new Promise<Response>(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce(upstreamResponse(204));
    const { POST } = await import("../../app/api/ping/route");
    const old = POST(post({ serviceId: SERVICE_ID }));
    await vi.waitFor(() => expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1));
    vi.mocked(readFileSync).mockReturnValue(BASE_YAML.replace("https://public.example/status", "https://replacement.example/health"));
    const { refreshConfigCache } = await import("@/config/server");
    refreshConfigCache(); refreshConfigCache();
    resolveOld(upstreamResponse(200));
    expect((await old).status).toBe(409);
    expect(await (await POST(post({ serviceId: SERVICE_ID }))).json()).toMatchObject({ status: 204 });
    expect(ssrfSafeFetchMock.mock.calls.map(([url]) => url)).toEqual(["https://public.example/status", "https://replacement.example/health"]);
  });

  it("scopes cached observations to the confirmed config generation even when the URL stays the same", async () => {
    ssrfSafeFetchMock.mockResolvedValueOnce(upstreamResponse(200)).mockResolvedValueOnce(upstreamResponse(503));
    const { POST } = await import("../../app/api/ping/route");
    expect(await (await POST(post({ serviceId: SERVICE_ID }))).json()).toMatchObject({ status: 200 });
    vi.mocked(readFileSync).mockReturnValue(`${BASE_YAML}\n# new confirmed generation`);
    const { refreshConfigCache } = await import("@/config/server");
    refreshConfigCache(); refreshConfigCache();
    expect(await (await POST(post({ serviceId: SERVICE_ID }))).json()).toMatchObject({ status: 503, assessment: "degraded" });
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a publication that wins while the final authorization check is awaiting", async () => {
    let releaseAuthorization!: () => void;
    const authorization = new Promise<void>(resolve => { releaseAuthorization = resolve; });
    let signalFinalAuthorization!: () => void;
    const finalStarted = new Promise<void>(resolve => { signalFinalAuthorization = resolve; });
    let checks = 0;
    vi.doMock("@/auth", async importOriginal => ({
      ...(await importOriginal<typeof import("@/auth")>()),
      isRequestAuthenticated: async () => {
        if (++checks === 2) { signalFinalAuthorization(); await authorization; }
        return true;
      },
    }));
    try {
      ssrfSafeFetchMock.mockResolvedValue(upstreamResponse(200));
      const { POST } = await import("../../app/api/ping/route");
      const pending = POST(post({ serviceId: SERVICE_ID }));
      await finalStarted;
      vi.mocked(readFileSync).mockReturnValue(AUTH_ENABLED_YAML.replace("https://public.example/status", "https://replacement.example/health"));
      const { refreshConfigCache } = await import("@/config/server");
      refreshConfigCache(); refreshConfigCache();
      releaseAuthorization();
      const response = await pending;
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "Configuration changed during the status check" });
    } finally { releaseAuthorization(); vi.doUnmock("@/auth"); }
  });
});

describe("POST /api/ping auth and config state", () => {
  beforeEach(async () => {
    vi.resetModules();
    ssrfSafeFetchMock.mockReset();
    vi.mocked(existsSync).mockImplementation((path?: unknown) => !String(path ?? "").includes("settings.yaml.displaced"));
    vi.mocked(readFileSync).mockReturnValue(AUTH_ENABLED_YAML);
    vi.stubEnv("KOKPIT_AUTH_DISABLED", "false");
    const { invalidateCache } = await import("@/config/loader");
    invalidateCache();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("requires a session when configured auth is enabled", async () => {
    const { POST } = await import("../../app/api/ping/route");
    expect((await POST(post({ serviceId: SERVICE_ID }))).status).toBe(401);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("does not publish a public probe after authentication becomes required in flight", async () => {
    vi.mocked(readFileSync).mockReturnValue(BASE_YAML);
    let resolveUpstream!: (response: Response) => void;
    ssrfSafeFetchMock.mockReturnValue(new Promise<Response>(resolve => { resolveUpstream = resolve; }));
    const { POST } = await import("../../app/api/ping/route");
    const pending = POST(post({ serviceId: SERVICE_ID }));
    await vi.waitFor(() => expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1));
    vi.mocked(readFileSync).mockReturnValue(AUTH_ENABLED_YAML);
    resolveUpstream(upstreamResponse(200));
    const response = await pending;
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("fails closed while the config source is dirty", async () => {
    vi.stubEnv("KOKPIT_AUTH_DISABLED", "true");
    const { getConfigSnapshot } = await import("@/config/server");
    getConfigSnapshot();
    vi.mocked(readFileSync).mockReturnValue(`${BASE_YAML}\n# external edit`);
    const { POST } = await import("../../app/api/ping/route");
    expect((await POST(post({ serviceId: SERVICE_ID }))).status).toBe(409);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("allows a valid config while it awaits migration", async () => {
    vi.stubEnv("KOKPIT_AUTH_DISABLED", "true");
    const { getConfigSnapshot, refreshConfigCache } = await import("@/config/server");
    expect(getConfigSnapshot().state).toBe("ready");
    vi.mocked(readFileSync).mockReturnValue("schema_version: 1\nservices:\n  - name: Legacy\n    url: http://192.168.1.20:8080\n");
    expect(refreshConfigCache()).toBe("dirty");
    expect(refreshConfigCache()).toBe("migration-required");
    const snapshot = getConfigSnapshot();
    ssrfSafeFetchMock.mockResolvedValue(upstreamResponse(200));
    const { POST } = await import("../../app/api/ping/route");
    expect(await (await POST(post({ serviceId: snapshot.config!.services[0].id }))).json()).toMatchObject({ ok: true, status: 200 });
  });
});
