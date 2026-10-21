// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let directory: string;
let configPath: string;
let dbPath: string;

function source(authEnabled: boolean): string {
  return `schema_version: 2\nauth:\n  enabled: ${authEnabled}\nappearance:\n  theme: dark\n  custom_css: sensitive-config-sentinel\nservices: []\nservice_tiles: []\n`;
}

beforeEach(() => {
  vi.resetModules();
  directory = mkdtempSync(path.join(os.tmpdir(), "kokpit-ready-"));
  configPath = path.join(directory, "settings.yaml");
  dbPath = path.join(directory, "database", "users.db");
  vi.stubEnv("KOKPIT_CONFIG_PATH", configPath);
  vi.stubEnv("KOKPIT_DB_PATH", dbPath);
  vi.stubEnv("KOKPIT_AUTH_DISABLED", "false");
});

afterEach(async () => {
  const { stopDatabaseLifecycle } = await import("@/auth/databaseLifecycle"); stopDatabaseLifecycle();
  const { closeDb } = await import("@/auth/db"); closeDb();
  const loader = await import("@/config/loader"); loader.invalidateCache();
  vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

function expectSafe(body: unknown): void {
  const text = JSON.stringify(body);
  expect(text).not.toContain("sensitive-config-sentinel");
  expect(text).not.toContain(directory);
  expect(text).not.toContain("users.db");
}

describe("GET /api/ready", () => {
  it.each([
    ["missing", undefined],
    ["legacy", "schema_version: 1\nauth:\n  enabled: false\nservices: []\n"],
    ["invalid", "auth: [ sensitive-config-sentinel\n"],
  ])("returns initializing for cold %s config without creating runtime artifacts", async (_name, contents) => {
    if (contents !== undefined) writeFileSync(configPath, contents);
    const { GET } = await import("@/app/api/ready/route");
    for (let i = 0; i < 3; i++) {
      const response = await GET();
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const body = await response.json();
      expect(body).toMatchObject({ status: "not_ready", checks: { config: "initializing", database: "not_checked" } });
      expectSafe(body);
    }
    expect(readdirSync(directory)).toEqual(contents === undefined ? [] : ["settings.yaml"]);
    if (contents !== undefined) expect(readFileSync(configPath, "utf8")).toBe(contents);
    expect(existsSync(dbPath)).toBe(false);
  });

  it.each([false, true])("does not require/create a DB when auth-disabled override=%s", async override => {
    writeFileSync(configPath, source(override));
    if (override) vi.stubEnv("KOKPIT_AUTH_DISABLED", "true");
    const loader = await import("@/config/loader"); loader.loadConfig();
    const { GET } = await import("@/app/api/ready/route");
    const response = await GET(); const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "ready", checks: { config: "ready", database: "not_required" } });
    expect(existsSync(dbPath)).toBe(false);
    expect(readdirSync(directory)).toEqual(["settings.yaml"]);
    const packageVersion = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")).version;
    expect(body.version).toBe(packageVersion);
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(response.headers.get("cache-control")).toContain("no-store"); expectSafe(body);
  });

  it("requires initialization when auth is enabled and accepts a first-run DB with no users", async () => {
    writeFileSync(configPath, source(true));
    const loader = await import("@/config/loader"); const config = loader.loadConfig();
    const { GET } = await import("@/app/api/ready/route");
    const before = await GET();
    expect(before.status).toBe(503);
    expect(await before.json()).toMatchObject({ checks: { config: "ready", database: "initializing" } });
    expect(existsSync(dbPath)).toBe(false);
    const { startDatabaseLifecycle } = await import("@/auth/databaseLifecycle"); startDatabaseLifecycle(config);
    const after = await GET(); const body = await after.json();
    expect(after.status).toBe(200);
    expect(body).toMatchObject({ status: "ready", checks: { config: "ready", database: "ready" } });
    const { getDb } = await import("@/auth/db");
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 0 });
    expectSafe(body);
  });

  it("initializes newly-required auth storage from config publication independently of probes", async () => {
    writeFileSync(configPath, source(false));
    const loader = await import("@/config/loader"); const initial = loader.loadConfig();
    const { startDatabaseLifecycle } = await import("@/auth/databaseLifecycle"); startDatabaseLifecycle(initial);
    const { GET } = await import("@/app/api/ready/route");
    expect((await GET()).status).toBe(200);
    expect(existsSync(dbPath)).toBe(false);
    writeFileSync(configPath, source(true));
    const changed = await GET();
    expect(changed.status).toBe(503);
    expect(await changed.json()).toMatchObject({ checks: { config: "unavailable", database: "not_checked" } });
    expect(existsSync(dbPath)).toBe(false);
    expect(loader.refreshConfigCache()).toBe("dirty");
    expect(loader.refreshConfigCache()).toBe("ready");
    await Promise.resolve();
    // The publication microtask has initialized storage before another probe.
    expect(existsSync(dbPath)).toBe(true);
    const ready = await GET();
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ checks: { config: "ready", database: "ready" } });
  });

  it.each(["TRUE", "1", " true "])("does not treat %j as the exact auth-disabled override", async value => {
    writeFileSync(configPath, source(true)); vi.stubEnv("KOKPIT_AUTH_DISABLED", value);
    const loader = await import("@/config/loader"); loader.loadConfig();
    const { GET } = await import("@/app/api/ready/route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ checks: { database: "initializing" } });
    expect(existsSync(dbPath)).toBe(false);
  });

  it("returns unavailable safely after failed required DB initialization", async () => {
    writeFileSync(configPath, source(true));
    vi.stubEnv("KOKPIT_DB_PATH", directory);
    const loader = await import("@/config/loader"); loader.loadConfig();
    const { getDb } = await import("@/auth/db"); expect(() => getDb()).toThrow();
    const { GET } = await import("@/app/api/ready/route");
    const response = await GET(); const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ status: "not_ready", checks: { config: "ready", database: "unavailable" } });
    expectSafe(body);
    expect(readdirSync(directory)).toEqual(["settings.yaml"]);
  });

  it("makes invalid external config unready while liveness stays healthy, then recovers via stable refresh", async () => {
    writeFileSync(configPath, source(false));
    const loader = await import("@/config/loader"); loader.loadConfig();
    const { GET } = await import("@/app/api/ready/route");
    expect((await GET()).status).toBe(200);
    const invalid = "auth: [ sensitive-config-sentinel\n"; writeFileSync(configPath, invalid);
    const failed = await GET(); const body = await failed.json();
    expect(failed.status).toBe(503);
    expect(body).toMatchObject({ status: "not_ready", checks: { config: "unavailable", database: "not_checked" } });
    expectSafe(body); expect(readFileSync(configPath, "utf8")).toBe(invalid);
    expect(readdirSync(directory)).toEqual(["settings.yaml"]);
    const { GET: liveness } = await import("@/app/api/health/route");
    expect((await liveness()).status).toBe(200);
    writeFileSync(configPath, source(false).replace("theme: dark", "theme: light"));
    expect(loader.refreshConfigCache()).toBe("dirty");
    expect(loader.refreshConfigCache()).toBe("ready");
    expect((await GET()).status).toBe(200);
    expect(readdirSync(directory)).toEqual(["settings.yaml"]);
  });

  it("reports migration-needed external config as restart-required without performing migration", async () => {
    writeFileSync(configPath, source(false));
    const loader = await import("@/config/loader"); loader.loadConfig();
    const legacy = "schema_version: 1\nauth:\n  enabled: false\nservices: []\n"; writeFileSync(configPath, legacy);
    expect(loader.refreshConfigCache()).toBe("dirty");
    expect(loader.refreshConfigCache()).toBe("migration-required");
    const { GET } = await import("@/app/api/ready/route");
    const response = await GET(); const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ status: "not_ready", checks: { config: "restart_required", database: "not_checked" } });
    expect(readFileSync(configPath, "utf8")).toBe(legacy);
    expect(readdirSync(directory)).toEqual(["settings.yaml"]);
    expectSafe(body);
  });
});
