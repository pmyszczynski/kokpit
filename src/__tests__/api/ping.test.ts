// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("proper-lockfile", () => ({ lockSync: vi.fn(() => () => undefined) }));
vi.mock("node:fs", () => {
  const readFileSync = vi.fn();
  const existsSync = vi.fn((path?: unknown) => !String(path ?? "").includes("settings.yaml.displaced"));
  return {
    default: { readFileSync, existsSync }, readFileSync, existsSync,
    writeFileSync: vi.fn(), linkSync: vi.fn(), unlinkSync: vi.fn(), mkdirSync: vi.fn(),
    renameSync: vi.fn(), statSync: vi.fn().mockReturnValue({ mode: 0o100644 }), chmodSync: vi.fn(),
  };
});
vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue({ get: () => undefined }) }));

const ssrfSafeFetchMock = vi.fn();
vi.mock("@/lib/ssrfGuard", () => ({ ssrfSafeFetch: (...args: unknown[]) => ssrfSafeFetchMock(...args) }));

import { existsSync, readFileSync } from "node:fs";

const SERVICE_ID = "10000000-0000-4000-8000-000000000001";
const LAN_SERVICE_ID = "10000000-0000-4000-8000-000000000002";
const BASE_YAML = `
schema_version: 2
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
service_tiles: []
`.trim();
const AUTH_ENABLED_YAML = BASE_YAML.replace("enabled: false", "enabled: true");

function response(status: number, cancel = vi.fn().mockResolvedValue(undefined)): Response {
  return { status, body: { cancel } } as unknown as Response;
}

function post(body: unknown, contentType = "application/json") {
  return new Request("http://localhost/api/ping", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/ping", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    ssrfSafeFetchMock.mockReset();
    process.env.KOKPIT_AUTH_DISABLED = "true";
    vi.mocked(existsSync).mockImplementation((path?: unknown) => !String(path ?? "").includes("settings.yaml.displaced"));
    vi.mocked(readFileSync).mockReturnValue(BASE_YAML);
    const { invalidateCache } = await import("@/config/loader");
    invalidateCache();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("accepts only JSON POST bodies", async () => {
    const { POST } = await import("../../app/api/ping/route");
    const contentType = await POST(post({ serviceId: SERVICE_ID }, "text/plain"));
    expect(contentType.status).toBe(415);
    const malformed = await POST(post("not json"));
    expect(malformed.status).toBe(400);
    const missing = await POST(post({}));
    expect(missing.status).toBe(400);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("does not accept an arbitrary caller-selected target", async () => {
    const { POST } = await import("../../app/api/ping/route");
    const res = await POST(post({ serviceId: SERVICE_ID, url: "http://169.254.169.254/latest/meta-data/" }));
    expect(res.status).toBe(200);
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
      "https://public.example/status",
      expect.objectContaining({ method: "HEAD", allowPrivateNetworks: true })
    );
  });

  it("probes saved public and LAN launch URLs through the shared guard", async () => {
    ssrfSafeFetchMock.mockResolvedValueOnce(response(200)).mockResolvedValueOnce(response(404));
    const { POST } = await import("../../app/api/ping/route");
    expect(await (await POST(post({ serviceId: SERVICE_ID }))).json()).toEqual({ ok: true, status: 200 });
    expect(await (await POST(post({ serviceId: LAN_SERVICE_ID }))).json()).toEqual({ ok: true, status: 404 });
    expect(ssrfSafeFetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://public.example/status", "http://192.168.1.10:8080/",
    ]);
    expect(ssrfSafeFetchMock.mock.calls.every(([, options]) => options.allowPrivateNetworks === true)).toBe(true);
  });

  it("rejects unknown and non-HTTP saved services without a network call", async () => {
    const { POST } = await import("../../app/api/ping/route");
    expect((await POST(post({ serviceId: "20000000-0000-4000-8000-000000000001" }))).status).toBe(404);
    vi.mocked(readFileSync).mockReturnValue(BASE_YAML.replace("https://public.example/status", "ftp://public.example/file"));
    const { invalidateCache } = await import("@/config/loader");
    invalidateCache();
    expect((await POST(post({ serviceId: SERVICE_ID }))).status).toBe(400);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("retries a 405 HEAD with GET and discards both response bodies", async () => {
    const headCancel = vi.fn().mockResolvedValue(undefined);
    const getCancel = vi.fn().mockResolvedValue(undefined);
    ssrfSafeFetchMock.mockResolvedValueOnce(response(405, headCancel)).mockResolvedValueOnce(response(200, getCancel));
    const { POST } = await import("../../app/api/ping/route");
    expect(await (await POST(post({ serviceId: SERVICE_ID }))).json()).toEqual({ ok: true, status: 200 });
    expect(ssrfSafeFetchMock.mock.calls.map(([, options]) => options.method)).toEqual(["HEAD", "GET"]);
    expect(headCancel).toHaveBeenCalledTimes(1);
    expect(getCancel).toHaveBeenCalledTimes(1);
  });

  it("returns a bounded, upstream-detail-free failure", async () => {
    ssrfSafeFetchMock.mockRejectedValue(new Error("upstream secret details"));
    const { POST } = await import("../../app/api/ping/route");
    expect(await (await POST(post({ serviceId: SERVICE_ID }))).json()).toEqual({ ok: false });
  });
});

describe("POST /api/ping auth and config state", () => {
  beforeEach(async () => {
    vi.resetModules();
    ssrfSafeFetchMock.mockReset();
    vi.mocked(existsSync).mockImplementation((path?: unknown) => !String(path ?? "").includes("settings.yaml.displaced"));
    vi.mocked(readFileSync).mockReturnValue(AUTH_ENABLED_YAML);
    process.env.KOKPIT_AUTH_DISABLED = "false";
    const { invalidateCache } = await import("@/config/loader");
    invalidateCache();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("requires a session when configured auth is enabled", async () => {
    const { POST } = await import("../../app/api/ping/route");
    expect((await POST(post({ serviceId: SERVICE_ID }))).status).toBe(401);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("fails closed while the configuration snapshot is dirty", async () => {
    process.env.KOKPIT_AUTH_DISABLED = "true";
    const { getConfigSnapshot } = await import("@/config/server");
    getConfigSnapshot();
    vi.mocked(readFileSync).mockReturnValue(`${BASE_YAML}\n# external edit`);
    const { POST } = await import("../../app/api/ping/route");
    expect((await POST(post({ serviceId: SERVICE_ID }))).status).toBe(409);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });
});
