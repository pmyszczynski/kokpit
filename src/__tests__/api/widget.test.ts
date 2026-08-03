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

import { existsSync, readFileSync } from "node:fs";

const SERVICES_YAML = `
schema_version: 2
auth:
  enabled: false
  session_ttl_hours: 24
appearance:
  theme: dark
layout:
  columns: 4
  row_height: 120
services:
  - id: 10000000-0000-4000-8000-000000000001
    name: Plex
    integration: { type: plex, config: { url: http://plex.test:32400, token: t } }
  - id: 10000000-0000-4000-8000-000000000002
    name: Broken Plex
    integration: { type: plex, config: { url: http://plex.test:32400 } }
  - id: 10000000-0000-4000-8000-000000000003
    name: Mystery
    integration: { type: not-a-real-widget, config: {} }
  - id: 10000000-0000-4000-8000-000000000004
    name: Tautulli
    integration: { type: tautulli, config: { url: http://tautulli.test:8181, api_key: tautulli-route-secret } }
  - id: 10000000-0000-4000-8000-000000000005
    name: Unraid
    integration: { type: unraid, config: { url: http://unraid.test, api_key: saved-unraid-secret } }
service_tiles:
  - { id: 20000000-0000-4000-8000-000000000001, service_id: 10000000-0000-4000-8000-000000000001, widget: { type: plex } }
  - { id: 20000000-0000-4000-8000-000000000002, service_id: 10000000-0000-4000-8000-000000000002, widget: { type: plex } }
  - { id: 20000000-0000-4000-8000-000000000003, service_id: 10000000-0000-4000-8000-000000000003, widget: { type: not-a-real-widget } }
  - { id: 20000000-0000-4000-8000-000000000004, service_id: 10000000-0000-4000-8000-000000000004, widget: { type: tautulli-activity } }
  - { id: 20000000-0000-4000-8000-000000000005, service_id: 10000000-0000-4000-8000-000000000005, widget: { type: unraid-stats } }
`.trim();

const AUTH_ENABLED_YAML = SERVICES_YAML.replace("enabled: false", "enabled: true");

function get(tile_id?: string) {
  return new Request(`http://localhost/api/widget${tile_id ? `?tile_id=${tile_id}` : ""}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(SERVICES_YAML);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // The "uses widget.fetchTimeoutMs" test below registers a permanent
  // `__slow-sidecar__` widget via registerWidget, which throws on a
  // duplicate id. vi.resetModules() in the next beforeEach gives a fresh
  // registry anyway, but clearing it here too means this doesn't depend on
  // that ordering — a real fragility under different module-import orders.
  const { clearRegistry } = await import("../../widgets");
  clearRegistry();
});

describe("GET /api/widget", () => {
  it("returns 400 when the tile_id parameter is missing", async () => {
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(get());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/missing tile_id/i);
  });

  it("returns 404 when the tile does not exist", async () => {
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(get("20000000-0000-4000-8000-000000000099"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not found/i);
  });

  it("returns 404 for an unknown widget type", async () => {
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(get("20000000-0000-4000-8000-000000000003"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/unknown widget type/i);
  });

  it("returns 400 when a tile has no widget", async () => {
    const { GET } = await import("../../app/api/widget/route");
    vi.mocked(readFileSync).mockReturnValue(SERVICES_YAML.replace(
      "widget: { type: plex }",
      "size: normal"
    ));
    const res = await GET(get("20000000-0000-4000-8000-000000000001"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no widget/i);
  });

  it("returns 400 when the stored config fails the widget schema", async () => {
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(get("20000000-0000-4000-8000-000000000002"));
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
    const res = await GET(get("20000000-0000-4000-8000-000000000001"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.streams).toBe(3);
  });

  it("returns a bounded 500 when the widget fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 502 } as Response)
    );
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(get("20000000-0000-4000-8000-000000000001"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Widget fetch failed");
  });

  it("does not reflect a saved secret from an upstream widget error", async () => {
    const rawMessage =
      "upstream rejected Authorization: Bearer saved-unraid-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ errors: [{ message: rawMessage }] }),
      } as Response)
    );
    const { GET } = await import("../../app/api/widget/route");

    const res = await GET(get("20000000-0000-4000-8000-000000000005"));
    const responseText = await res.text();

    expect(res.status).toBe(500);
    expect(responseText).toContain("Widget fetch failed");
    expect(responseText).not.toContain(rawMessage);
    expect(responseText).not.toContain("saved-unraid-secret");
  });

  it("does not return Tautulli network rejection details from the generic route", async () => {
    const leakedUrl =
      "http://tautulli.test:8181/api/v2?apikey=tautulli-route-secret&cmd=get_activity";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error(`fetch failed for ${leakedUrl}`))
    );
    const { GET } = await import("../../app/api/widget/route");

    const res = await GET(
      get("20000000-0000-4000-8000-000000000004")
    );
    const responseText = await res.text();

    expect(res.status).toBe(500);
    expect(responseText).toContain("Widget fetch failed");
    expect(responseText).not.toContain(leakedUrl);
    expect(responseText).not.toContain("apikey=");
    expect(responseText).not.toContain("tautulli-route-secret");
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
    const resPromise = GET(get("20000000-0000-4000-8000-000000000001"));
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
    const resPromise = GET(get("20000000-0000-4000-8000-000000000001"));
    await vi.advanceTimersByTimeAsync(5001);
    const res = await resPromise;
    expect(res.status).toBe(504);
    expect((await res.json()).error).toMatch(/timed out/i);
  });

  // The two tests above already prove that a widget with no fetchTimeoutMs
  // (e.g. plex) times out at the global 5s default. This test proves the
  // opposite side: a widget that sets fetchTimeoutMs overrides that default
  // rather than merely extending it — the request must still be in flight
  // once the global 5s default has passed, and only end once the widget's
  // own timeout elapses.
  it("uses widget.fetchTimeoutMs instead of the 5s default when set", async () => {
    vi.useFakeTimers();
    const { registerWidget } = await import("../../widgets");
    const { z } = await import("zod");
    registerWidget({
      id: "__slow-sidecar__",
      name: "Slow Sidecar (test only)",
      configSchema: z.object({}),
      // Never resolves — only the hard timeout can end this request.
      fetchData: () => new Promise(() => {}),
      component: () => null,
      fetchTimeoutMs: 9000,
    });
    vi.mocked(readFileSync).mockReturnValue(
      SERVICES_YAML.replace(
        "service_tiles:",
        "  - id: 10000000-0000-4000-8000-000000000006\n    name: SlowSidecar\nservice_tiles:"
      ) +
        "\n  - { id: 20000000-0000-4000-8000-000000000006, service_id: 10000000-0000-4000-8000-000000000006, widget: { type: __slow-sidecar__ } }"
    );
    const { GET } = await import("../../app/api/widget/route");
    const resPromise = GET(get("20000000-0000-4000-8000-000000000006"));

    let settled = false;
    resPromise.then(() => {
      settled = true;
    });

    // Past the global 5s default but still under the widget's own 9s
    // override — must still be in flight.
    await vi.advanceTimersByTimeAsync(5001);
    expect(settled).toBe(false);

    // Now past the 9s override.
    await vi.advanceTimersByTimeAsync(4000);
    const res = await resPromise;
    expect(res.status).toBe(504);
    expect((await res.json()).error).toMatch(/timed out/i);
  });
});

describe("GET /api/widget – auth", () => {
  beforeEach(() => {
    vi.mocked(readFileSync).mockReturnValue(AUTH_ENABLED_YAML);
    process.env.KOKPIT_AUTH_DISABLED = "false";
  });

  afterEach(() => {
    delete process.env.KOKPIT_AUTH_DISABLED;
  });

  it("returns 401 without a session when auth is enabled", async () => {
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(get("20000000-0000-4000-8000-000000000001"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/unauthorized/i);
  });

  it("proceeds without a session when KOKPIT_AUTH_DISABLED is set", async () => {
    process.env.KOKPIT_AUTH_DISABLED = "true";
    const { GET } = await import("../../app/api/widget/route");
    const res = await GET(get("20000000-0000-4000-8000-000000000099"));
    // Auth passed; fails later on service lookup instead.
    expect(res.status).toBe(404);
  });
});
