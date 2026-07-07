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

describe("GET /api/widget – request validation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(AUTH_DISABLED_YAML);
  });

  it("returns 400 when type param is missing", async () => {
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(new Request("http://localhost/api/widget"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/type/i);
  });

  it("returns 400 when service param is missing", async () => {
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(new Request("http://localhost/api/widget?type=plex"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/service/i);
  });

  it("returns 404 for an unknown widget type", async () => {
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(
      new Request("http://localhost/api/widget?type=nope&service=Whatever")
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/unknown widget/i);
  });

  it("returns 404 when the service is not configured", async () => {
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(
      new Request("http://localhost/api/widget?type=plex&service=Ghost")
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/service not found/i);
  });
});

describe("GET /api/widget – auth", () => {
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
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(
      new Request("http://localhost/api/widget?type=plex&service=Plex")
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/unauthorized/i);
  });

  it("proceeds without a session when KOKPIT_AUTH_DISABLED is set", async () => {
    process.env.KOKPIT_AUTH_DISABLED = "true";
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(
      new Request("http://localhost/api/widget?type=plex&service=Ghost")
    );
    // Auth passed; fails later on service lookup instead.
    expect(res.status).toBe(404);
  });
});
