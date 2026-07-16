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

import { existsSync, readFileSync } from "node:fs";

// Fixture services: one valid Plex widget, one with an incomplete config,
// and one with a widget type that isn't registered.
const SERVICES_YAML = `
schema_version: 1
auth:
  enabled: false
  session_ttl_hours: 24
appearance:
  theme: dark
layout:
  columns: 4
  row_height: 120
services:
  - name: Plex
    url: http://plex.local
    widget:
      type: plex
      config:
        url: http://plex.test:32400
        token: t
  - name: Broken Plex
    widget:
      type: plex
      config:
        url: http://plex.test:32400
  - name: Mystery
    widget:
      type: not-a-real-widget
`.trim();

function get(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return new Request(`http://localhost/api/widget?${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(SERVICES_YAML);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("GET /api/widget", () => {
  it("returns 400 when the type parameter is missing", async () => {
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(get({ service: "Plex" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/missing type/i);
  });

  it("returns 400 when the service parameter is missing", async () => {
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(get({ type: "plex" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/missing service/i);
  });

  it("returns 404 for an unknown widget type", async () => {
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(get({ type: "not-a-real-widget", service: "Mystery" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/unknown widget type/i);
  });

  it("returns 404 when the service does not exist in settings", async () => {
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(get({ type: "plex", service: "Nope" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/service not found/i);
  });

  it("returns 400 when the stored config fails the widget schema", async () => {
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(get({ type: "plex", service: "Broken Plex" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid widget config/i);
    expect(json.error).toMatch(/token/);
  });

  it("returns { ok: true, data } when the widget fetch succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ MediaContainer: { size: 3, Metadata: [{}, {}, {}] } }),
      } as Response)
    );
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(get({ type: "plex", service: "Plex" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.streams).toBe(3);
  });

  it("returns 500 with the error message when the widget fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 502 } as Response)
    );
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(get({ type: "plex", service: "Plex" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/502/);
  });

  it("returns 504 even when the widget ignores its abort signal", async () => {
    vi.useFakeTimers();
    // A fetch that never settles, abort or not — the hard timeout race is
    // the only thing that can end this request.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise(() => {}))
    );
    const { GET } = await import("../../app/api/widget/route");
    const resPromise = GET(get({ type: "plex", service: "Plex" }));
    await vi.advanceTimersByTimeAsync(5001);
    const res = await resPromise;
    expect(res.status).toBe(504);
    expect((await res.json()).error).toMatch(/timed out/i);
  });

  it("returns 504 when the widget fetch exceeds the 5s timeout", async () => {
    vi.useFakeTimers();
    // A fetch that never settles until its signal aborts — the route's
    // AbortController is the only thing that can end this request.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: string, opts?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts?.signal?.addEventListener("abort", () =>
              reject(new Error("aborted"))
            );
          })
      )
    );
    const { GET } = await import("../../app/api/widget/route");
    const resPromise = GET(get({ type: "plex", service: "Plex" }));
    await vi.advanceTimersByTimeAsync(5001);
    const res = await resPromise;
    expect(res.status).toBe(504);
    expect((await res.json()).error).toMatch(/timed out/i);
  });
});
