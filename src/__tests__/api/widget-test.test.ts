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

const BASE_YAML = `
schema_version: 1
auth:
  enabled: false
  session_ttl_hours: 24
appearance:
  theme: dark
layout:
  columns: 4
  row_height: 120
services: []
`.trim();

const AUTH_YAML = BASE_YAML.replace("enabled: false", "enabled: true");

function post(body: unknown) {
  return new Request("http://localhost/api/widget/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(BASE_YAML);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/widget/test", () => {
  it("returns 401 when auth is enabled and no session cookie is present", async () => {
    vi.stubEnv("KOKPIT_AUTH_DISABLED", "false");
    vi.mocked(readFileSync).mockReturnValue(AUTH_YAML);
    const { POST } = await import("../../app/api/widget/test/route");
    const res = await POST(post({ type: "plex", config: {} }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for malformed JSON", async () => {
    const { POST } = await import("../../app/api/widget/test/route");
    const res = await POST(post("not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid json/i);
  });

  it("returns 400 when type is missing", async () => {
    const { POST } = await import("../../app/api/widget/test/route");
    const res = await POST(post({ config: {} }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/missing type/i);
  });

  it("returns 404 for an unknown widget type", async () => {
    const { POST } = await import("../../app/api/widget/test/route");
    const res = await POST(post({ type: "does-not-exist", config: {} }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/unknown widget type/i);
  });

  it("returns 400 with issue details when the config fails the widget schema", async () => {
    const { POST } = await import("../../app/api/widget/test/route");
    const res = await POST(post({ type: "plex", config: {} }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/invalid widget config/i);
    expect(json.error).toMatch(/url/);
    expect(json.error).toMatch(/token/);
  });

  it("returns { ok: true } when the widget fetch succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ MediaContainer: { size: 2, Metadata: [] } }),
      } as Response)
    );
    const { POST } = await import("../../app/api/widget/test/route");
    const res = await POST(
      post({
        type: "plex",
        config: { url: "http://plex.test:32400", token: "t" },
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
  });

  it("returns 500 with the error message when the widget fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response)
    );
    const { POST } = await import("../../app/api/widget/test/route");
    const res = await POST(
      post({
        type: "plex",
        config: { url: "http://plex.test:32400", token: "t" },
      })
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/503/);
  });
});
