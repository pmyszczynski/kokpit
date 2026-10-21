// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/auth/session", () => ({ getAuthUser: mocks.user, SESSION_COOKIE_NAME: "session" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("proper-lockfile", async (original) => {
  const actual = await original<typeof import("proper-lockfile")>();
  return { ...actual, lockSync: vi.fn(actual.lockSync) };
});

const PUBLIC = "schema_version: 2\nauth: { enabled: false }\nappearance: { theme: dark }\nlayout: {}\nservices: []\nservice_tiles: []\n";
const PRIVATE = PUBLIC.replace("enabled: false", "enabled: true");
const LEGACY = "auth: { enabled: false }\nappearance: { theme: light }\nlayout: {}\nservices: []\n";
const UNAVAILABLE = { error: "Configuration temporarily unavailable", code: "config_unavailable" };
let directory: string;
let configPath: string;
let loader: typeof import("@/config/loader");
let GET: typeof import("@/app/api/config/revision/route").GET;

async function expectUnavailable() {
  const response = await GET();
  expect(response.status).toBe(503);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual(UNAVAILABLE);
}

describe("revision polling with real configuration files", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    directory = mkdtempSync(join(tmpdir(), "kokpit-revision-route-"));
    configPath = join(directory, "settings.yaml");
    vi.stubEnv("KOKPIT_CONFIG_PATH", configPath);
    vi.stubEnv("KOKPIT_AUTH_DISABLED", "false");
    vi.stubEnv("KOKPIT_SESSION_SECRET", "revision-loader-test-signing-secret");
    mocks.user.mockResolvedValue(null);
    loader = await import("@/config/loader");
    loader.invalidateCache();
    ({ GET } = await import("@/app/api/config/revision/route"));
  });
  afterEach(() => {
    loader.invalidateCache();
    rmSync(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it.each([PUBLIC, LEGACY])("does not initialize or migrate a cold file", async (source) => {
    writeFileSync(configPath, source, { mode: 0o640 });
    const before = readdirSync(directory);
    await expectUnavailable();
    expect(readFileSync(configPath, "utf8")).toBe(source);
    expect(readdirSync(directory)).toEqual(before);
    expect(loader.getPublishedConfigSnapshot().state).toBe("cold");
    const { lockSync } = await import("proper-lockfile");
    expect(lockSync).not.toHaveBeenCalled();
  });

  it("does not create missing configuration on a cold poll, including the auth override", async () => {
    vi.stubEnv("KOKPIT_AUTH_DISABLED", "true");
    await expectUnavailable();
    expect(readdirSync(directory)).toEqual([]);
    const { lockSync } = await import("proper-lockfile");
    expect(lockSync).not.toHaveBeenCalled();
  });

  it("never serves retained public state while an invalid or missing file is dirty", async () => {
    writeFileSync(configPath, PUBLIC);
    loader.getConfigSnapshot();
    expect((await GET()).status).toBe(200);
    writeFileSync(configPath, "auth: [invalid: synthetic-secret");
    await expectUnavailable();
    expect(loader.refreshConfigCache()).toBe("dirty");
    await expectUnavailable();
    unlinkSync(configPath);
    await expectUnavailable();
    expect(readdirSync(directory)).toEqual([]);
  });

  it("fails a request/disk race and authorizes the recovered private snapshot anew", async () => {
    writeFileSync(configPath, PUBLIC);
    loader.getConfigSnapshot();
    const pending = GET();
    // The auth await yields even for a public snapshot. The next exact-source
    // check must detect a private replacement before returning its old HMAC.
    writeFileSync(configPath, PRIVATE);
    const interrupted = await pending;
    expect(interrupted.status).toBe(503);
    expect(await interrupted.json()).toEqual(UNAVAILABLE);
    expect(loader.refreshConfigCache()).toBe("ready");
    const denied = await GET();
    expect(denied.status).toBe(401);
    expect(denied.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await denied.json()).toEqual({ error: "Unauthorized" });
    expect(readFileSync(configPath, "utf8")).toBe(PRIVATE);
  });

  it("reports a hot migration snapshot without rewriting YAML, backups, or locking", async () => {
    writeFileSync(configPath, PUBLIC);
    loader.getConfigSnapshot();
    const { lockSync } = await import("proper-lockfile");
    vi.mocked(lockSync).mockClear();
    writeFileSync(configPath, LEGACY);
    loader.markConfigDirty();
    expect(loader.refreshConfigCache()).toBe("migration-required");
    const before = readdirSync(directory);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toEqual({ revision: expect.stringMatching(/^[a-f0-9]{64}$/), editable: false, reason: "migration-required" });
    expect(readFileSync(configPath, "utf8")).toBe(LEGACY);
    expect(readdirSync(directory)).toEqual(before);
    expect(lockSync).not.toHaveBeenCalled();
  });

  it("changes the exact-source revision for comment-only external edits", async () => {
    writeFileSync(configPath, PUBLIC);
    loader.getConfigSnapshot();
    const first = await (await GET()).json();
    writeFileSync(configPath, `${PUBLIC}# external comment\n`);
    await expectUnavailable();
    expect(loader.refreshConfigCache()).toBe("ready");
    const second = await (await GET()).json();
    expect(second.editable).toBe(true);
    expect(second.revision).not.toBe(first.revision);
  });
});
