// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { KokpitConfigSchema } from "@/config/schema";

const mocks = vi.hoisted(() => ({ write: vi.fn(), proof: vi.fn(), snapshot: vi.fn() }));
vi.mock("@/auth", () => ({
  SESSION_COOKIE_NAME: "session",
  isRequestAuthenticated: async () => true,
  isAuthenticationEnabled: () => true,
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "opaque-token" }) }) }));
vi.mock("@/auth/reauthenticate", () => ({ verifySessionPassword: mocks.proof }));
vi.mock("@/config/server", () => ({
  getConfigSnapshot: mocks.snapshot,
  getConfigSnapshotForWrite: mocks.snapshot,
  writeConfigSnapshot: mocks.write,
  ConfigUnavailableError: class extends Error {},
  ConfigRevisionMismatchError: class extends Error {},
}));
vi.mock("@/lib/uploadGc", () => ({ pruneOrphanedUploads: async () => undefined }));
vi.mock("@/config/revision", () => ({ CONFIG_REVISION_HEADER: "X-Config-Revision", configRevision: () => "revision" }));
vi.mock("@/widgets/configSecrets", () => ({ toClientSafeSettings: (config: unknown) => config }));

function request(auth: unknown, password?: string, trusted = true) {
  return new NextRequest("http://localhost/api/settings", {
    method: "PATCH",
    headers: trusted ? { "X-Kokpit-Request": "1" } : {},
    body: JSON.stringify({ auth, auth_password: password }),
  });
}

describe("persistent session policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const config = KokpitConfigSchema.parse({ schema_version: 2, auth: { enabled: true, session_ttl_hours: 24 } });
    mocks.snapshot.mockReturnValue({ state: "ready", config, source: "settings" });
    mocks.write.mockImplementation((updates) => ({
      config: { ...config, ...updates },
      source: "written-settings",
    }));
    mocks.proof.mockResolvedValue({ auth: { user: {}, session: {} } });
  });

  it("defaults to persistent sessions while accepting legacy TTL configuration", () => {
    const legacy = KokpitConfigSchema.parse({ schema_version: 2, auth: { enabled: true, session_ttl_hours: 24 } });
    expect(legacy.auth.session_idle_timeout_hours ?? 0).toBe(0);
    expect(KokpitConfigSchema.parse({ schema_version: 2 }).auth.session_idle_timeout_hours ?? 0).toBe(0);
  });

  it("requires a trusted request and fresh password before changing policy", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    expect((await PATCH(request({ enabled: true, session_idle_timeout_hours: 0 }, "password", false))).status).toBe(403);
    mocks.proof.mockResolvedValue({ error: "Invalid password", status: 401 });
    expect((await PATCH(request({ enabled: true, session_idle_timeout_hours: 0 }, "wrong"))).status).toBe(401);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("persists only the new policy, never the confirmation password or legacy expiry", async () => {
    const { PATCH } = await import("../../app/api/settings/route");
    const response = await PATCH(request({ enabled: true, session_idle_timeout_hours: 48 }, "password"));
    expect(response.status).toBe(200);
    expect(mocks.proof).toHaveBeenCalledWith("opaque-token", "password");
    expect(mocks.write.mock.calls[0][0]).toEqual({ auth: { enabled: true, session_idle_timeout_hours: 48 } });
    expect((await response.json()).auth).toEqual({ enabled: true, session_idle_timeout_hours: 48 });
  });

  it.each([-1, 0.5, 8761, "24"])("rejects invalid idle timeout %s", async (value) => {
    const { PATCH } = await import("../../app/api/settings/route");
    expect((await PATCH(request({ enabled: true, session_idle_timeout_hours: value }))).status).toBe(400);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
