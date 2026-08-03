// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", () => {
  const readFileSync = vi.fn();
  const writeFileSync = vi.fn();
  const existsSync = vi.fn().mockReturnValue(true);
  const mkdirSync = vi.fn();
  const renameSync = vi.fn();
  const statSync = vi.fn().mockReturnValue({ mode: 0o100644 });
  const chmodSync = vi.fn();
  return {
    default: { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, statSync, chmodSync },
    readFileSync,
    writeFileSync,
    existsSync,
    mkdirSync,
    renameSync,
    statSync,
    chmodSync,
  };
});
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}));

process.env.KOKPIT_AUTH_DISABLED = "true";

import { existsSync, readFileSync } from "node:fs";
import { WIDGET_SECRET_REFERENCE_KEY } from "@/widgets/secretReference";
import "@/integrations";
import { getAllWidgets } from "@/widgets";

// Every registered widget type, with what its schema says about an empty
// config. Collected once at module load; the tests re-import the route (and
// a fresh registry) after vi.resetModules(), but the ids are stable.
const allWidgets = getAllWidgets().map((w) => ({
  id: w.id,
  emptyConfigValid: w.configSchema.safeParse({}).success,
}));

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

const TAUTULLI_SECRET_YAML = BASE_YAML.replace(
  "services: []",
  `services:
  - name: Tautulli
    url: http://tautulli.local:8181
    widget:
      type: tautulli-activity
      config:
        url: http://tautulli.local:8181
        api_key: saved-tautulli-secret
        sections:
          - summary`
);

const UNRAID_SECRET_YAML = BASE_YAML.replace(
  "services: []",
  `services:
  - name: Unraid
    widget:
      type: unraid-stats
      config:
        url: http://unraid.local
        api_key: saved-unraid-secret`
);

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

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  // The "uses widget.fetchTimeoutMs" test below registers a permanent
  // `__slow-sidecar__` widget via registerWidget, which throws on a
  // duplicate id. vi.resetModules() in the next beforeEach gives a fresh
  // registry anyway, but clearing it here too means this doesn't depend on
  // that ordering — a real fragility under different module-import orders.
  const { clearRegistry } = await import("../../widgets");
  clearRegistry();
});

describe("POST /api/widget/test", () => {
  it("returns a bounded 500 when secret resolution fails unexpectedly", async () => {
    vi.doMock("@/widgets/configSecrets", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/widgets/configSecrets")>()),
      resolveWidgetConfigSecrets: () => {
        throw new Error("leaked internal secret resolver detail");
      },
    }));
    try {
      const { POST } = await import("../../app/api/widget/test/route");
      const res = await POST(post({ type: "plex", config: {} }));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body).toEqual({
        ok: false,
        error: "Connection test failed",
      });
      expect(JSON.stringify(body)).not.toContain("leaked");
    } finally {
      vi.doUnmock("@/widgets/configSecrets");
    }
  });

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

  it.each(allWidgets)(
    "$id: validates an empty config according to its schema",
    async ({ id, emptyConfigValid }) => {
      // The docker widget doesn't use global fetch — it speaks node:http over
      // a unix socket. Point it at a guaranteed-missing socket so its attempt
      // fails deterministically regardless of the host running the tests.
      vi.stubEnv("KOKPIT_DOCKER_SOCKET", "/nonexistent/docker.sock");
      // Likewise, system-stats reads real /proc via process.getBuiltinModule,
      // which bypasses this file's vi.mock("node:fs"). On a Linux CI host an
      // empty config would happily read the real /proc and succeed (200),
      // breaking the 500 assertion below. Point it at a guaranteed-missing
      // proc dir so every read fails deterministically instead.
      vi.stubEnv("KOKPIT_PROC_PATH", "/nonexistent/proc");
      const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
      vi.stubGlobal("fetch", fetchMock);
      const { POST } = await import("../../app/api/widget/test/route");
      const res = await POST(post({ type: id, config: {} }));
      if (emptyConfigValid) {
        // Schema accepts an empty config — the endpoint attempts the fetch.
        expect(res.status).toBe(500);
        if (id !== "docker" && id !== "system-stats") {
          expect(fetchMock).toHaveBeenCalled();
        }
      } else {
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/invalid widget config/i);
        expect(fetchMock).not.toHaveBeenCalled();
      }
    }
  );

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

  it("resolves a redacted saved password server-side for a connection test", async () => {
    vi.mocked(readFileSync).mockReturnValue(TAUTULLI_SECRET_YAML);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.searchParams.get("apikey") !== "saved-tautulli-secret") {
          return Promise.reject(new Error("saved secret was not resolved"));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              response: {
                result: "success",
                message: null,
                data: { stream_count: 0, sessions: [] },
              },
            }),
        } as Response);
      })
    );
    const { GET } = await import("../../app/api/settings/route");
    const settings = await (await GET()).json();
    const redactedConfig = settings.services[0].integration.config;
    expect(JSON.stringify(redactedConfig)).not.toContain(
      "saved-tautulli-secret"
    );

    const { POST } = await import("../../app/api/widget/test/route");
    const res = await POST(
      post({ type: "tautulli-activity", config: redactedConfig })
    );
    const responseText = await res.text();

    expect(res.status).toBe(200);
    expect(responseText).toBe('{"ok":true}');
    expect(responseText).not.toContain("saved-tautulli-secret");
  });

  it("rejects an endpoint-changed saved reference before fetch with a safe code", async () => {
    vi.mocked(readFileSync).mockReturnValue(TAUTULLI_SECRET_YAML);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("../../app/api/settings/route");
    const settings = await (await GET()).json();
    const redactedConfig = settings.services[0].integration.config;
    redactedConfig.url = "http://attacker.invalid:8181";

    const { POST } = await import("../../app/api/widget/test/route");
    const res = await POST(
      post({ type: "tautulli-activity", config: redactedConfig })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      code: "widget_secret_scope_changed",
    });
    expect(JSON.stringify(body)).not.toContain("attacker.invalid");
    expect(JSON.stringify(body)).not.toContain("saved-tautulli-secret");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects forged and cross-widget references before fetch", async () => {
    vi.mocked(readFileSync).mockReturnValue(TAUTULLI_SECRET_YAML);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("../../app/api/settings/route");
    const settings = await (await GET()).json();
    const reference = settings.services[0].integration.config.api_key as Record<
      string,
      string
    >;
    const token = reference[WIDGET_SECRET_REFERENCE_KEY];
    const forged = {
      [WIDGET_SECRET_REFERENCE_KEY]:
        token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"),
    };

    const { POST } = await import("../../app/api/widget/test/route");
    for (const [type, config] of [
      [
        "tautulli-activity",
        { ...settings.services[0].integration.config, api_key: forged },
      ],
      [
        "plex",
        {
          url: "http://tautulli.local:8181",
          token: reference,
        },
      ],
    ] as const) {
      const res = await POST(post({ type, config }));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.code).toBe("widget_secret_reference_invalid");
      expect(JSON.stringify(body)).not.toContain("saved-tautulli-secret");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 504 when the connection test exceeds the 5s timeout", async () => {
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
    const { POST } = await import("../../app/api/widget/test/route");
    const resPromise = POST(
      post({
        type: "plex",
        config: { url: "http://plex.test:32400", token: "t" },
      })
    );
    await vi.advanceTimersByTimeAsync(5001);
    const res = await resPromise;
    expect(res.status).toBe(504);
    expect((await res.json()).error).toMatch(/timed out/i);
  });

  it("returns 504 even when the widget ignores its abort signal", async () => {
    vi.useFakeTimers();
    // A fetch that never settles, abort or not — the hard timeout race is
    // the only thing that can end this request.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise(() => {}))
    );
    const { POST } = await import("../../app/api/widget/test/route");
    const resPromise = POST(
      post({
        type: "plex",
        config: { url: "http://plex.test:32400", token: "t" },
      })
    );
    await vi.advanceTimersByTimeAsync(5001);
    const res = await resPromise;
    expect(res.status).toBe(504);
    expect((await res.json()).error).toMatch(/timed out/i);
  });

  it("keeps the hard-timeout response for an aborted Tautulli request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: string, opts?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts?.signal?.addEventListener("abort", () =>
              reject(
                new Error(
                  "aborted http://tautulli.test/api/v2?apikey=tautulli-secret"
                )
              )
            );
          })
      )
    );
    const { POST } = await import("../../app/api/widget/test/route");
    const resPromise = POST(
      post({
        type: "tautulli-activity",
        config: {
          url: "http://tautulli.test",
          api_key: "tautulli-secret",
        },
      })
    );

    await vi.advanceTimersByTimeAsync(5001);
    const res = await resPromise;
    const responseText = await res.text();

    expect(res.status).toBe(504);
    expect(responseText).toContain("Connection test timed out");
    expect(responseText).not.toContain("tautulli-secret");
    expect(responseText).not.toContain("apikey=");
  });

  it("returns a bounded 500 when the widget fetch fails", async () => {
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
    expect(json.error).toBe("Connection test failed");
  });

  it("does not reflect a saved secret from an upstream connection-test error", async () => {
    vi.mocked(readFileSync).mockReturnValue(UNRAID_SECRET_YAML);
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
    const { GET } = await import("../../app/api/settings/route");
    const settings = await (await GET()).json();
    const redactedConfig = settings.services[0].integration.config;
    expect(JSON.stringify(redactedConfig)).not.toContain(
      "saved-unraid-secret"
    );

    const { POST } = await import("../../app/api/widget/test/route");
    const res = await POST(
      post({ type: "unraid-stats", config: redactedConfig })
    );
    const responseText = await res.text();

    expect(res.status).toBe(500);
    expect(responseText).toContain("Connection test failed");
    expect(responseText).not.toContain(rawMessage);
    expect(responseText).not.toContain("saved-unraid-secret");
  });

  // The two "returns 504" tests above already prove that a widget with no
  // fetchTimeoutMs (plex) times out at the global 5s default. This test
  // proves the opposite side: a widget that sets fetchTimeoutMs overrides
  // that default rather than merely extending it — the request must still
  // be in flight once the global 5s default has passed, and only end once
  // the widget's own timeout elapses.
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
    const { POST } = await import("../../app/api/widget/test/route");
    const resPromise = POST(post({ type: "__slow-sidecar__", config: {} }));

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
