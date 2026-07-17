// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", () => {
  const readFileSync = vi.fn();
  const writeFileSync = vi.fn();
  const existsSync = vi.fn().mockReturnValue(true);
  const mkdirSync = vi.fn();
  return {
    default: { readFileSync, writeFileSync, existsSync, mkdirSync },
    readFileSync,
    writeFileSync,
    existsSync,
    mkdirSync,
  };
});
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}));

process.env.KOKPIT_AUTH_DISABLED = "true";

import { existsSync, readFileSync } from "node:fs";

const AUTH_DISABLED_YAML = `
schema_version: 1
auth:
  enabled: false
  session_ttl_hours: 24
services: []
`.trim();

const AUTH_ENABLED_YAML = `
schema_version: 1
auth:
  enabled: true
  session_ttl_hours: 24
services: []
`.trim();

describe("GET /api/ping", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(AUTH_DISABLED_YAML);
  });

  it("returns 400 when url param is missing", async () => {
    const { GET } = await import("../../app/api/ping/route");
    const req = new Request("http://localhost/api/ping");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/missing/i);
  });

  it("returns 400 when url param is not a valid URL", async () => {
    const { GET } = await import("../../app/api/ping/route");
    const req = new Request("http://localhost/api/ping?url=not-a-url");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid/i);
  });

  it("returns ok:true when target responds with 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ status: 200 } as Response)
    );
    const { GET } = await import("../../app/api/ping/route");
    const req = new Request(
      "http://localhost/api/ping?url=http%3A%2F%2Fexample.com"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe(200);
  });

  it("returns ok:true even when target responds with 404 (host is reachable)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ status: 404 } as Response)
    );
    const { GET } = await import("../../app/api/ping/route");
    const req = new Request(
      "http://localhost/api/ping?url=http%3A%2F%2Fexample.com"
    );
    const res = await GET(req);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe(404);
  });

  it("retries with GET when HEAD returns 405", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ status: 405 } as Response)
      .mockResolvedValueOnce({ status: 200 } as Response);
    vi.stubGlobal("fetch", mockFetch);
    const { GET } = await import("../../app/api/ping/route");
    const req = new Request(
      "http://localhost/api/ping?url=http%3A%2F%2Fexample.com"
    );
    const res = await GET(req);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][1].method).toBe("HEAD");
    expect(mockFetch.mock.calls[1][1].method).toBe("GET");
  });

  it("returns ok:false on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED"))
    );
    const { GET } = await import("../../app/api/ping/route");
    const req = new Request(
      "http://localhost/api/ping?url=http%3A%2F%2Fexample.com"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("returns ok:false on timeout (AbortError)", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(abortError));
    const { GET } = await import("../../app/api/ping/route");
    const req = new Request(
      "http://localhost/api/ping?url=http%3A%2F%2Fexample.com"
    );
    const res = await GET(req);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });
});

describe("GET /api/ping – auth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(AUTH_ENABLED_YAML);
    process.env.KOKPIT_AUTH_DISABLED = "false";
  });

  afterEach(() => {
    process.env.KOKPIT_AUTH_DISABLED = "true";
  });

  it("returns 401 without a session when auth is enabled", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { GET } = await import("../../app/api/ping/route");
    const req = new Request(
      "http://localhost/api/ping?url=http%3A%2F%2Fexample.com"
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("succeeds without a session when KOKPIT_AUTH_DISABLED is set", async () => {
    process.env.KOKPIT_AUTH_DISABLED = "true";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ status: 200 } as Response)
    );
    const { GET } = await import("../../app/api/ping/route");
    const req = new Request(
      "http://localhost/api/ping?url=http%3A%2F%2Fexample.com"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});
