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

function htmlResponse(html: string, url = "http://example.com/") {
  return {
    ok: true,
    url,
    body: {
      getReader: () => {
        let done = false;
        return {
          read: async () => {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: new TextEncoder().encode(html) };
          },
          cancel: async () => {},
        };
      },
    },
  } as unknown as Response;
}

describe("GET /api/icon/detect", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(AUTH_DISABLED_YAML);
  });

  it("returns 400 when url param is missing", async () => {
    const { GET } = await import("../../app/api/icon/detect/route");
    const req = new Request("http://localhost/api/icon/detect");
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/missing/i);
  });

  it("returns 400 when url param is not a valid URL", async () => {
    const { GET } = await import("../../app/api/icon/detect/route");
    const req = new Request("http://localhost/api/icon/detect?url=not-a-url");
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid/i);
  });

  it("returns the icon found on the page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        htmlResponse(
          '<html><head><link rel="icon" href="/icon.png"></head></html>',
          "http://example.com/"
        )
      )
    );
    const { GET } = await import("../../app/api/icon/detect/route");
    const req = new Request(
      "http://localhost/api/icon/detect?url=http%3A%2F%2Fexample.com"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ icon: "http://example.com/icon.png", source: "page" });
  });

  it("returns icon: null when nothing is found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 404, ok: false } as Response)
    );
    const { GET } = await import("../../app/api/icon/detect/route");
    const req = new Request(
      "http://localhost/api/icon/detect?url=http%3A%2F%2Fexample.com"
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ icon: null, source: null });
  });
});

describe("GET /api/icon/detect – auth", () => {
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
    const { GET } = await import("../../app/api/icon/detect/route");
    const req = new Request(
      "http://localhost/api/icon/detect?url=http%3A%2F%2Fexample.com"
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
