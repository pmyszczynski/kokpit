// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { KokpitConfigSchema } from "@/config/schema";
import { AUTH_JSON_BODY_BYTES, ICON_DETECTION_BODY_BYTES, SETTINGS_BODY_BYTES, WIDGET_TEST_BODY_BYTES } from "@/lib/requestBody";

process.env.KOKPIT_DB_PATH = ":memory:";
process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";
const mocks = vi.hoisted(() => ({ cookie: vi.fn(), snapshot: vi.fn(), write: vi.fn(), detectIcon: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie, set: vi.fn(), delete: vi.fn() }) }));
vi.mock("@/config/server", () => ({
  getConfig: () => mocks.snapshot().config,
  getConfigSnapshot: mocks.snapshot,
  getPublishedConfigSnapshot: mocks.snapshot,
  getConfigSnapshotForWrite: mocks.snapshot,
  writeConfigSnapshot: mocks.write,
  legacyIntegrationType: (type: string) => type === "sonarr-calendar" ? "sonarr" : null,
  ConfigUnavailableError: class extends Error {},
  ConfigRevisionMismatchError: class extends Error {},
}));
vi.mock("@/lib/uploadGc", () => ({ pruneOrphanedUploads: async () => {} }));
vi.mock("@/lib/iconDetect", () => ({ detectServiceIcon: mocks.detectIcon }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete process.env.KOKPIT_AUTH_DISABLED;
  mocks.cookie.mockReturnValue(undefined);
  mocks.snapshot.mockReturnValue({
    state: "ready", source: "published-source",
    config: KokpitConfigSchema.parse({ schema_version: 2, auth: { enabled: true } }),
  });
});

const endpoints = [
  { name: "login", path: "auth/login", method: "POST", limit: AUTH_JSON_BODY_BYTES, protected: false, load: () => import("@/app/api/auth/login/route") },
  { name: "setup", path: "setup", method: "POST", limit: AUTH_JSON_BODY_BYTES, protected: false, load: () => import("@/app/api/setup/route") },
  { name: "reset password", path: "auth/reset-password", method: "POST", limit: AUTH_JSON_BODY_BYTES, protected: false, load: () => import("@/app/api/auth/reset-password/route") },
  { name: "TOTP verify", path: "auth/totp/verify", method: "POST", limit: AUTH_JSON_BODY_BYTES, protected: false, load: () => import("@/app/api/auth/totp/verify/route") },
  { name: "recovery code", path: "auth/recovery-code", method: "POST", limit: AUTH_JSON_BODY_BYTES, protected: true, load: () => import("@/app/api/auth/recovery-code/route") },
  { name: "TOTP setup", path: "auth/totp/setup", method: "POST", limit: AUTH_JSON_BODY_BYTES, protected: true, load: () => import("@/app/api/auth/totp/setup/route") },
  { name: "TOTP disable", path: "auth/totp/setup", method: "DELETE", limit: AUTH_JSON_BODY_BYTES, protected: true, load: () => import("@/app/api/auth/totp/setup/route") },
  { name: "session actions", path: "auth/sessions", method: "POST", limit: AUTH_JSON_BODY_BYTES, protected: true, load: () => import("@/app/api/auth/sessions/route") },
  { name: "settings", path: "settings", method: "PATCH", limit: SETTINGS_BODY_BYTES, protected: true, load: () => import("@/app/api/settings/route") },
  { name: "widget connection test", path: "widget/test", method: "POST", limit: WIDGET_TEST_BODY_BYTES, protected: true, load: () => import("@/app/api/widget/test/route") },
  { name: "icon detection", path: "icon/detect", method: "POST", limit: ICON_DETECTION_BODY_BYTES, protected: true, load: () => import("@/app/api/icon/detect/route") },
] as const;

async function authenticate() {
  const auth = await import("@/auth");
  const user = await auth.createUser("body-boundary-test", "unused-password-hash");
  const session = auth.createSession(user.id);
  mocks.cookie.mockReturnValue({ value: session.token });
  return { auth, user, session };
}

function request(path: string, method: string, body: string | ReadableStream<Uint8Array>): NextRequest {
  return new NextRequest(`http://localhost/api/${path}`, {
    method, headers: { "x-kokpit-request": "1", "content-type": "application/json" },
    body, ...(typeof body === "string" ? {} : { duplex: "half" }),
  } as ConstructorParameters<typeof NextRequest>[1]);
}

describe.each(endpoints)("$name request boundary", endpoint => {
  async function call(body: string | ReadableStream<Uint8Array>) {
    const route = await endpoint.load() as Record<string, (request: NextRequest) => Promise<Response>>;
    return route[endpoint.method](request(endpoint.path, endpoint.method, body));
  }

  it.each(["null", "[]", '"primitive"'])("rejects JSON %s with a controlled 400", async body => {
    if (endpoint.protected) await authenticate();
    expect((await call(body)).status).toBe(400);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("returns 413 for streamed overflow without Content-Length", async () => {
    if (endpoint.protected) await authenticate();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(endpoint.limit + 1)); }, cancel,
    });
    const response = await call(stream);
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(await response.text()).not.toContain("unused-password-hash");
    expect(mocks.write).not.toHaveBeenCalled();
  });

  if (endpoint.protected) {
    it("rejects unauthorized callers before consuming body bytes", async () => {
      const req = request(endpoint.path, endpoint.method, "not valid JSON");
      const reader = vi.spyOn(req.body!, "getReader");
      const route = await endpoint.load() as Record<string, (request: NextRequest) => Promise<Response>>;
      expect((await route[endpoint.method](req)).status).toBe(401);
      expect(reader).not.toHaveBeenCalled();
      expect(req.bodyUsed).toBe(false);
    });
  }
});

describe("authorization during body streaming", () => {
  it.each(["widget/test", "icon/detect"])("does not start %s outbound work after mid-body session revocation", async path => {
    const { auth, user, session } = await authenticate();
    const { getWidget } = await import("@/widgets");
    await import("@/integrations");
    const upstream = vi.spyOn(getWidget("sonarr-calendar")!, "fetchData").mockResolvedValue([]);
    try {
      const payload = path === "widget/test"
        ? { type: "sonarr-calendar", config: { url: "http://sonarr.local/", api_key: "test-key" } }
        : { url: "http://service.local/" };
      const req = request(path, "POST", JSON.stringify(payload));
      const acquireReader = req.body!.getReader.bind(req.body!);
      vi.spyOn(req.body!, "getReader").mockImplementationOnce(() => {
        auth.revokeSession(user.id, session.session.id);
        return acquireReader();
      });
      const { POST } = path === "widget/test"
        ? await import("@/app/api/widget/test/route") : await import("@/app/api/icon/detect/route");
      expect((await POST(req)).status).toBe(401);
      expect(upstream).not.toHaveBeenCalled();
      expect(mocks.detectIcon).not.toHaveBeenCalled();
    } finally { upstream.mockRestore(); }
  });

  it("still forbids connection tests when authentication is disabled mid-body", async () => {
    await authenticate();
    await import("@/integrations");
    const { getWidget } = await import("@/widgets");
    const upstream = vi.spyOn(getWidget("sonarr-calendar")!, "fetchData").mockResolvedValue([]);
    try {
      const req = request("widget/test", "POST", JSON.stringify({
        type: "sonarr-calendar", config: { url: "http://sonarr.local/", api_key: "test-key" },
      }));
      const acquireReader = req.body!.getReader.bind(req.body!);
      vi.spyOn(req.body!, "getReader").mockImplementationOnce(() => {
        mocks.snapshot.mockReturnValue({
          state: "ready", source: "public",
          config: KokpitConfigSchema.parse({ schema_version: 2, auth: { enabled: false } }),
        });
        return acquireReader();
      });
      const { POST } = await import("@/app/api/widget/test/route");
      expect((await POST(req)).status).toBe(403);
      expect(upstream).not.toHaveBeenCalled();
    } finally { upstream.mockRestore(); }
  });

  it("does not start icon discovery when a public config becomes protected mid-body", async () => {
    mocks.snapshot.mockReturnValue({
      state: "ready", source: "public",
      config: KokpitConfigSchema.parse({ schema_version: 2, auth: { enabled: false } }),
    });
    const req = request("icon/detect", "POST", '{"url":"http://service.local/"}');
    const acquireReader = req.body!.getReader.bind(req.body!);
    vi.spyOn(req.body!, "getReader").mockImplementationOnce(() => {
      mocks.snapshot.mockReturnValue({
        state: "ready", source: "private",
        config: KokpitConfigSchema.parse({ schema_version: 2, auth: { enabled: true } }),
      });
      return acquireReader();
    });
    const { POST } = await import("@/app/api/icon/detect/route");
    expect((await POST(req)).status).toBe(401);
    expect(mocks.detectIcon).not.toHaveBeenCalled();
  });

  it("resolves saved connection credentials from the fresh post-body snapshot", async () => {
    await authenticate();
    await import("@/integrations");
    const { getWidget } = await import("@/widgets");
    const { toClientSafeSettings } = await import("@/widgets/configSecrets");
    const config = (apiKey: string) => KokpitConfigSchema.parse({
      schema_version: 2, auth: { enabled: true }, services: [{
        id: "10000000-0000-4000-8000-000000000001", name: "Sonarr", launch_url: "http://sonarr.local/",
        integration: { type: "sonarr", config: { url: "http://sonarr.local/", api_key: apiKey } },
      }],
    });
    const oldConfig = config("old-connection-key");
    mocks.snapshot.mockReturnValue({ state: "ready", source: "old", config: oldConfig });
    const safeConnection = toClientSafeSettings(oldConfig).services[0].integration!.config;
    const upstream = vi.spyOn(getWidget("sonarr-calendar")!, "fetchData").mockResolvedValue([]);
    try {
      const req = request("widget/test", "POST", JSON.stringify({ type: "sonarr-calendar", config: safeConnection }));
      const acquireReader = req.body!.getReader.bind(req.body!);
      vi.spyOn(req.body!, "getReader").mockImplementationOnce(() => {
        mocks.snapshot.mockReturnValue({ state: "ready", source: "new", config: config("new-connection-key") });
        return acquireReader();
      });
      const { POST } = await import("@/app/api/widget/test/route");
      expect((await POST(req)).status).toBe(200);
      expect(upstream).toHaveBeenCalledWith(
        expect.objectContaining({ api_key: "new-connection-key" }), expect.any(AbortSignal)
      );
    } finally { upstream.mockRestore(); }
  });

  it("does not revoke a session after its own authorizing session was revoked mid-body", async () => {
    const { auth, user, session } = await authenticate();
    const second = auth.createSession(user.id);
    const payload = new TextEncoder().encode(JSON.stringify({ action: "revoke", sessionId: session.session.id }));
    const req = request("auth/sessions", "POST", new TextDecoder().decode(payload));
    const acquireReader = req.body!.getReader.bind(req.body!);
    vi.spyOn(req.body!, "getReader").mockImplementationOnce(() => {
      auth.revokeSession(user.id, session.session.id);
      return acquireReader();
    });
    const { POST } = await import("@/app/api/auth/sessions/route");
    expect((await POST(req)).status).toBe(401);
    expect(auth.listSessions(user.id).map(row => row.id)).toEqual([second.session.id]);
  });

  it("rejects a settings write if auth becomes enabled while the body is read", async () => {
    const publicConfig = KokpitConfigSchema.parse({ schema_version: 2, auth: { enabled: false } });
    mocks.snapshot.mockReturnValue({ state: "ready", config: publicConfig, source: "public" });
    const req = request("settings", "PATCH", '{"appearance":{"theme":"light"}}');
    const acquireReader = req.body!.getReader.bind(req.body!);
    vi.spyOn(req.body!, "getReader").mockImplementationOnce(() => {
      mocks.snapshot.mockReturnValue({
        state: "ready", source: "private",
        config: KokpitConfigSchema.parse({ schema_version: 2, auth: { enabled: true } }),
      });
      return acquireReader();
    });
    const { PATCH } = await import("@/app/api/settings/route");
    expect((await PATCH(req)).status).toBe(401);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("does not initialize config or consume a body when startup has not published it", async () => {
    mocks.snapshot.mockReturnValue({ state: "cold", source: null, config: null });
    const req = request("settings", "PATCH", "{}");
    const { PATCH } = await import("@/app/api/settings/route");
    expect((await PATCH(req)).status).toBe(409);
    expect(req.bodyUsed).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
