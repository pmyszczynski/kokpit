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

const dnsLookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => dnsLookupMock(...args),
}));

const undiciFetchMock = vi.fn();
vi.mock("undici", () => ({
  fetch: (...args: unknown[]) => undiciFetchMock(...args),
  Agent: class {
    constructor(_opts: unknown) {}
  },
}));

process.env.KOKPIT_AUTH_DISABLED = "true";

import { existsSync, readFileSync } from "node:fs";

const PUBLIC_IP = "93.184.216.34";
const LOOPBACK_IP = "127.0.0.1";
const METADATA_IP = "169.254.169.254";

function resolvesTo(ip: string, family: 4 | 6 = 4) {
  return [{ address: ip, family }];
}

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
    status: 200,
    url,
    headers: new Headers({ "content-type": "text/html" }),
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
  };
}

function plainResponse(status: number, headers: Record<string, string> = {}) {
  return { ok: status >= 200 && status < 300, status, url: "", headers: new Headers(headers) };
}

function post(body: unknown) {
  return new Request("http://localhost/api/icon/detect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/icon/detect", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    dnsLookupMock.mockReset();
    undiciFetchMock.mockReset();
    dnsLookupMock.mockResolvedValue(resolvesTo(PUBLIC_IP));
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(AUTH_DISABLED_YAML);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 400 for malformed JSON", async () => {
    const { POST } = await import("../../app/api/icon/detect/route");
    const res = await POST(post("not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid json/i);
  });

  it("returns 415 for a text/plain request even with a JSON-shaped body", async () => {
    // A hostile page can auto-submit a hidden <form> with
    // enctype="text/plain" as a CORS-simple request (no preflight, no
    // user click needed) — browsers can't set application/json from a
    // plain form, only from script, so this must be rejected.
    const { POST } = await import("../../app/api/icon/detect/route");
    const req = new Request("http://localhost/api/icon/detect", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ url: "http://example.com" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(415);
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when url is missing", async () => {
    const { POST } = await import("../../app/api/icon/detect/route");
    const res = await POST(post({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/missing/i);
  });

  it("returns 400 when url is not a valid URL", async () => {
    const { POST } = await import("../../app/api/icon/detect/route");
    const res = await POST(post({ url: "not-a-url" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid/i);
  });

  it("returns 400 for a non-http(s) url", async () => {
    const { POST } = await import("../../app/api/icon/detect/route");
    const res = await POST(post({ url: "ftp://example.com/file" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid/i);
  });

  it("returns the icon found on the page", async () => {
    undiciFetchMock.mockResolvedValueOnce(
      htmlResponse('<html><head><link rel="icon" href="/icon.png"></head></html>', "http://example.com/")
    );
    const { POST } = await import("../../app/api/icon/detect/route");
    const res = await POST(post({ url: "http://example.com" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ icon: "http://example.com/icon.png", source: "page" });
  });

  it("returns icon: null when nothing is found", async () => {
    undiciFetchMock.mockResolvedValue(plainResponse(404));
    const { POST } = await import("../../app/api/icon/detect/route");
    const res = await POST(post({ url: "http://example.com" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ icon: null, source: null });
  });

  it("returns icon: null for a blocked host (cloud metadata) without making a request", async () => {
    dnsLookupMock.mockResolvedValue(resolvesTo(METADATA_IP));
    const { POST } = await import("../../app/api/icon/detect/route");
    const res = await POST(post({ url: "http://169.254.169.254/latest/meta-data/" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ icon: null, source: null });
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it("blocks a LAN/loopback target by default", async () => {
    dnsLookupMock.mockResolvedValue(resolvesTo(LOOPBACK_IP));
    const { POST } = await import("../../app/api/icon/detect/route");
    const res = await POST(post({ url: "http://127.0.0.1:8080" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ icon: null, source: null });
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it("allows a LAN/loopback target once KOKPIT_ICON_DETECT_ALLOW_PRIVATE_NETWORKS=true", async () => {
    vi.stubEnv("KOKPIT_ICON_DETECT_ALLOW_PRIVATE_NETWORKS", "true");
    dnsLookupMock.mockResolvedValue(resolvesTo(LOOPBACK_IP));
    undiciFetchMock.mockResolvedValueOnce(
      htmlResponse('<html><head><link rel="icon" href="/icon.png"></head></html>', "http://127.0.0.1:8080/")
    );
    const { POST } = await import("../../app/api/icon/detect/route");
    const res = await POST(post({ url: "http://127.0.0.1:8080" }));
    expect(res.status).toBe(200);
    expect((await res.json()).icon).not.toBeNull();
  });
});

describe("POST /api/icon/detect – auth", () => {
  beforeEach(() => {
    vi.resetModules();
    dnsLookupMock.mockReset();
    undiciFetchMock.mockReset();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(AUTH_ENABLED_YAML);
    process.env.KOKPIT_AUTH_DISABLED = "false";
  });

  afterEach(() => {
    process.env.KOKPIT_AUTH_DISABLED = "true";
  });

  it("returns 401 without a session when auth is enabled", async () => {
    const { POST } = await import("../../app/api/icon/detect/route");
    const res = await POST(post({ url: "http://example.com" }));
    expect(res.status).toBe(401);
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });
});
