// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KokpitConfigSchema } from "@/config/schema";
import type { ConfigSnapshot } from "@/config/loader";

const mocks = vi.hoisted(() => ({ published: vi.fn(), bootstrap: vi.fn(), user: vi.fn(), cookies: vi.fn() }));
vi.mock("@/config/server", () => ({ getPublishedConfigSnapshot: mocks.published, getConfigSnapshot: mocks.bootstrap }));
vi.mock("@/auth/session", () => ({ getAuthUser: mocks.user, SESSION_COOKIE_NAME: "session" }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

import { GET } from "@/app/api/config/revision/route";
import { configRevision } from "@/config/revision";

const SOURCE = "schema_version: 2\nauth: { enabled: false }\nprivate_extension: { api_key: synthetic-secret }\n";
const UNAVAILABLE = { error: "Configuration temporarily unavailable", code: "config_unavailable" };
let token: string | undefined;

function snapshot(authEnabled = false, state: "ready" | "migration-required" = "ready"): ConfigSnapshot {
  return {
    state,
    config: KokpitConfigSchema.parse({ schema_version: 2, auth: { enabled: authEnabled }, private_extension: { token: "synthetic-secret" } }),
    source: SOURCE,
  };
}

async function expectResponse(status: number, body: unknown) {
  const response = await GET();
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("ETag")).toBeNull();
  expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  expect(response.headers.get("Location")).toBeNull();
  expect(await response.json()).toEqual(body);
  return response;
}

describe("GET /api/config/revision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("KOKPIT_AUTH_DISABLED", "false");
    vi.stubEnv("KOKPIT_SESSION_SECRET", "revision-route-test-signing-secret");
    token = undefined;
    mocks.cookies.mockResolvedValue({ get: () => token ? { value: token } : undefined });
    mocks.user.mockResolvedValue(null);
    mocks.published.mockReturnValue(snapshot());
    mocks.bootstrap.mockImplementation(() => { throw new Error("Polling cannot bootstrap YAML"); });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "valid", "expired", "revoked"])("returns a minimal public revision with cookie %s", async (cookie) => {
    token = cookie;
    await expectResponse(200, { revision: configRevision(SOURCE), editable: true });
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });

  it("permits a current session against the exact stable private snapshot", async () => {
    token = "current-session";
    mocks.published.mockReturnValue(snapshot(true));
    mocks.user.mockResolvedValue({ id: "user", username: "admin" });
    await expectResponse(200, { revision: configRevision(SOURCE), editable: true });
    expect(mocks.user).toHaveBeenCalledWith("current-session");
    expect(mocks.published).toHaveBeenCalledTimes(3);
  });

  it.each([undefined, "expired", "revoked"])("denies private access for cookie %s without exposing configuration", async (cookie) => {
    token = cookie;
    mocks.published.mockReturnValue(snapshot(true));
    await expectResponse(401, { error: "Unauthorized" });
    expect(mocks.user).toHaveBeenCalledWith(cookie);
  });

  it("denies an installation with no account or session through the same generic response", async () => {
    mocks.published.mockReturnValue(snapshot(true));
    await expectResponse(401, { error: "Unauthorized" });
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });

  it("checks a revoked session again even when the source revision has not changed", async () => {
    token = "session";
    mocks.published.mockReturnValue(snapshot(true));
    mocks.user.mockResolvedValueOnce({ id: "user" }).mockResolvedValueOnce(null);
    await expectResponse(200, { revision: configRevision(SOURCE), editable: true });
    await expectResponse(401, { error: "Unauthorized" });
    expect(mocks.user).toHaveBeenCalledTimes(2);
  });

  it("rechecks a public-to-private policy change on the next poll", async () => {
    await expectResponse(200, { revision: configRevision(SOURCE), editable: true });
    mocks.published.mockReturnValue({ ...snapshot(true), source: `${SOURCE}# private now\n` });
    await expectResponse(401, { error: "Unauthorized" });
  });

  it("permits the exact operational override on a valid private config", async () => {
    vi.stubEnv("KOKPIT_AUTH_DISABLED", "true");
    mocks.published.mockReturnValue(snapshot(true));
    await expectResponse(200, { revision: configRevision(SOURCE), editable: true });
    expect(mocks.cookies).not.toHaveBeenCalled();
  });

  it.each(["TRUE", "1", "false", ""])("does not broaden operational override value %s", async (override) => {
    vi.stubEnv("KOKPIT_AUTH_DISABLED", override);
    mocks.published.mockReturnValue(snapshot(true));
    await expectResponse(401, { error: "Unauthorized" });
  });

  it.each([false, true])("reports migration-required only to allowed viewers (private: %s)", async (privateConfig) => {
    mocks.published.mockReturnValue(snapshot(privateConfig, "migration-required"));
    if (privateConfig) { token = "valid"; mocks.user.mockResolvedValue({ id: "user" }); }
    await expectResponse(200, { revision: configRevision(SOURCE), editable: false, reason: "migration-required" });
  });

  it("denies an unauthorized migration snapshot without revealing its reason or revision", async () => {
    mocks.published.mockReturnValue(snapshot(true, "migration-required"));
    await expectResponse(401, { error: "Unauthorized" });
  });

  it.each([
    { state: "cold", config: null, source: null },
    { ...snapshot(), state: "dirty" },
    { ...snapshot(), config: null },
    { ...snapshot(), source: null },
  ] satisfies ConfigSnapshot[])("never publishes unavailable state $state", async (current) => {
    mocks.published.mockReturnValue(current);
    await expectResponse(503, UNAVAILABLE);
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });

  it("keeps configuration validity separate from the auth override", async () => {
    vi.stubEnv("KOKPIT_AUTH_DISABLED", "true");
    mocks.published.mockReturnValue({ ...snapshot(), state: "dirty" });
    await expectResponse(503, UNAVAILABLE);
  });

  it.each(["dirty", "ready", "migration-required"] as const)("fails closed if the source changes during session verification (%s)", async (state) => {
    const initial = snapshot(true);
    mocks.published.mockReturnValueOnce(initial).mockReturnValue({ ...initial, state, source: `${SOURCE}# changed\n` });
    mocks.user.mockResolvedValue({ id: "user" });
    await expectResponse(503, UNAVAILABLE);
  });

  it("does not assert stale denial when config becomes unavailable during auth", async () => {
    const initial = snapshot(true);
    mocks.published.mockReturnValueOnce(initial).mockReturnValue({ ...initial, state: "dirty" });
    await expectResponse(503, UNAVAILABLE);
  });

  it("checks the published source again after deriving the revision", async () => {
    const initial = snapshot();
    mocks.published.mockReturnValueOnce(initial).mockReturnValueOnce(initial).mockReturnValue({ ...initial, source: `${SOURCE}# changed\n` });
    await expectResponse(503, UNAVAILABLE);
  });

  it("does not serve a new publication under an authorization check for the previous config", async () => {
    const initial = snapshot();
    mocks.published.mockReturnValueOnce(initial).mockReturnValue({ ...initial, config: snapshot(true).config });
    await expectResponse(503, UNAVAILABLE);
  });

  it.each(["snapshot", "session"])("hides %s failures and their private details", async (failure) => {
    if (failure === "snapshot") mocks.published.mockImplementation(() => { throw new Error("/private/settings.yaml parser: synthetic-secret"); });
    else {
      mocks.published.mockReturnValue(snapshot(true));
      mocks.user.mockRejectedValue(new Error("private database failure: synthetic-secret"));
    }
    await expectResponse(503, UNAVAILABLE);
  });
});
