// @vitest-environment node
import { mkdtempSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KokpitConfigSchema } from "@/config/schema";

let directory: string;
let dbPath: string;
beforeEach(async () => {
  (await import("@/auth/databaseLifecycle")).stopDatabaseLifecycle();
  (await import("@/auth/db")).closeDb();
  vi.resetModules();
  directory = mkdtempSync(path.join(os.tmpdir(), "kokpit-db-lifecycle-"));
  dbPath = path.join(directory, "users.db");
  vi.stubEnv("KOKPIT_DB_PATH", dbPath);
  vi.stubEnv("KOKPIT_AUTH_DISABLED", "false");
});
afterEach(async () => {
  (await import("@/auth/databaseLifecycle")).stopDatabaseLifecycle();
  (await import("@/auth/db")).closeDb();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("database application lifecycle", () => {
  it("initializes required SQLite at startup before probes", async () => {
    const { startDatabaseLifecycle } = await import("@/auth/databaseLifecycle");
    const { getDatabaseReadiness } = await import("@/auth/databaseReadiness");
    startDatabaseLifecycle(KokpitConfigSchema.parse({ schema_version: 2 }));
    expect(existsSync(dbPath)).toBe(true);
    expect(getDatabaseReadiness()).toBe("ready");
  });

  it.each(["config", "override"])("does not create a database when auth is disabled through %s", async source => {
    if (source === "override") vi.stubEnv("KOKPIT_AUTH_DISABLED", "true");
    const { startDatabaseLifecycle } = await import("@/auth/databaseLifecycle");
    startDatabaseLifecycle(KokpitConfigSchema.parse({ schema_version: 2, auth: { enabled: source !== "config" } }));
    expect(existsSync(dbPath)).toBe(false);
  });

  it("initializes newly required services after publication, outside its synchronous write operation", async () => {
    const { startDatabaseLifecycle } = await import("@/auth/databaseLifecycle");
    const { notifyConfigPublished } = await import("@/config/publication");
    startDatabaseLifecycle(KokpitConfigSchema.parse({ schema_version: 2, auth: { enabled: false } }));
    notifyConfigPublished(KokpitConfigSchema.parse({ schema_version: 2, auth: { enabled: true } }));
    expect(existsSync(dbPath)).toBe(false);
    await Promise.resolve();
    expect(existsSync(dbPath)).toBe(true);
  });

  it("does not initialize from an outdated queued policy after it is disabled", async () => {
    const { startDatabaseLifecycle } = await import("@/auth/databaseLifecycle");
    const { notifyConfigPublished } = await import("@/config/publication");
    const disabled = KokpitConfigSchema.parse({ schema_version: 2, auth: { enabled: false } });
    startDatabaseLifecycle(disabled);
    notifyConfigPublished(KokpitConfigSchema.parse({ schema_version: 2 }));
    notifyConfigPublished(disabled);
    await Promise.resolve();
    expect(existsSync(dbPath)).toBe(false);
  });

  it("cancels queued initialization when the lifecycle stops", async () => {
    const { startDatabaseLifecycle, stopDatabaseLifecycle } = await import("@/auth/databaseLifecycle");
    const { notifyConfigPublished } = await import("@/config/publication");
    startDatabaseLifecycle(KokpitConfigSchema.parse({ schema_version: 2, auth: { enabled: false } }));
    notifyConfigPublished(KokpitConfigSchema.parse({ schema_version: 2 }));
    stopDatabaseLifecycle();
    await Promise.resolve();
    expect(existsSync(dbPath)).toBe(false);
  });

  it("logs a safe real initialization failure once until recovery and keeps probes read-only", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const database = await import("@/auth/db");
    const initialize = vi.spyOn(database, "getDb");
    const { startDatabaseLifecycle } = await import("@/auth/databaseLifecycle");
    const { notifyConfigPublished } = await import("@/config/publication");
    const { getDatabaseReadiness } = await import("@/auth/databaseReadiness");
    const enabled = KokpitConfigSchema.parse({ schema_version: 2 });
    mkdirSync(dbPath);
    startDatabaseLifecycle(enabled);
    expect(getDatabaseReadiness()).toBe("unavailable");
    expect(errorLog.mock.calls).toEqual([["[kokpit] Authentication database initialization failed (SQLITE_CANTOPEN)."]]);
    for (let i = 0; i < 3; i++) {
      notifyConfigPublished(enabled);
      await Promise.resolve();
    }
    expect(errorLog).toHaveBeenCalledTimes(1);
    const attempts = initialize.mock.calls.length;
    for (let i = 0; i < 5; i++) expect(getDatabaseReadiness()).toBe("unavailable");
    expect(initialize).toHaveBeenCalledTimes(attempts);
    expect(errorLog).toHaveBeenCalledTimes(1);

    rmSync(dbPath, { recursive: true });
    notifyConfigPublished(enabled);
    await Promise.resolve();
    expect(getDatabaseReadiness()).toBe("ready");
    expect(errorLog).toHaveBeenCalledTimes(1);
    database.closeDb();
    rmSync(dbPath);
    mkdirSync(dbPath);
    notifyConfigPublished(enabled);
    await Promise.resolve();
    expect(getDatabaseReadiness()).toBe("unavailable");
    expect(errorLog).toHaveBeenCalledTimes(2);
  });

  it("resets a failure incident after auth is disabled or the lifecycle restarts", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const database = await import("@/auth/db");
    const initialize = vi.spyOn(database, "getDb");
    const { startDatabaseLifecycle } = await import("@/auth/databaseLifecycle");
    const { notifyConfigPublished } = await import("@/config/publication");
    const enabled = KokpitConfigSchema.parse({ schema_version: 2 });
    const disabled = KokpitConfigSchema.parse({ schema_version: 2, auth: { enabled: false } });
    mkdirSync(dbPath);
    startDatabaseLifecycle(enabled);
    expect(errorLog).toHaveBeenCalledTimes(1);
    const attempts = initialize.mock.calls.length;
    notifyConfigPublished(disabled);
    await Promise.resolve();
    expect(initialize).toHaveBeenCalledTimes(attempts);
    expect(errorLog).toHaveBeenCalledTimes(1);
    notifyConfigPublished(enabled);
    await Promise.resolve();
    expect(errorLog).toHaveBeenCalledTimes(2);
    startDatabaseLifecycle(enabled);
    expect(errorLog).toHaveBeenCalledTimes(3);
  });

  it("bounds diagnostics by code without exposing error messages, hostile codes or getters", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "private-token /private/config/settings.yaml";
    let failure: unknown = Object.assign(new Error(secret), { code: "SQLITE_BUSY" });
    const database = await import("@/auth/db");
    vi.spyOn(database, "getDb").mockImplementation(() => { throw failure; });
    const { startDatabaseLifecycle } = await import("@/auth/databaseLifecycle");
    const { notifyConfigPublished } = await import("@/config/publication");
    const enabled = KokpitConfigSchema.parse({ schema_version: 2 });
    const publish = async () => { notifyConfigPublished(enabled); await Promise.resolve(); };
    startDatabaseLifecycle(enabled);
    failure = Object.assign(new Error(secret), { code: "SQLITE_LOCKED" });
    await publish();
    failure = Object.assign(new Error(secret), { code: "SQLITE_BUSY" });
    await publish();
    failure = Object.assign(new Error(secret), { code: secret });
    await publish();
    failure = Object.defineProperty({}, "code", { get() { throw new Error(secret); } });
    await publish();
    failure = secret;
    await publish();
    expect(errorLog.mock.calls).toEqual([
      ["[kokpit] Authentication database initialization failed (SQLITE_BUSY)."],
      ["[kokpit] Authentication database initialization failed (SQLITE_LOCKED)."],
      ["[kokpit] Authentication database initialization failed (UNKNOWN)."],
    ]);
  });

  it("does not initialize or log for cancelled queued policies", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const database = await import("@/auth/db");
    const initialize = vi.spyOn(database, "getDb").mockImplementation(() => {
      throw Object.assign(new Error("not for logs"), { code: "SQLITE_BUSY" });
    });
    const { startDatabaseLifecycle, stopDatabaseLifecycle } = await import("@/auth/databaseLifecycle");
    const { notifyConfigPublished } = await import("@/config/publication");
    const disabled = KokpitConfigSchema.parse({ schema_version: 2, auth: { enabled: false } });
    const enabled = KokpitConfigSchema.parse({ schema_version: 2 });
    startDatabaseLifecycle(disabled);
    notifyConfigPublished(enabled);
    notifyConfigPublished(disabled);
    await Promise.resolve();
    notifyConfigPublished(enabled);
    stopDatabaseLifecycle();
    await Promise.resolve();
    expect(initialize).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("keeps startup and publication failures contained when the diagnostic sink throws", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => { throw new Error("broken log sink"); });
    const { startDatabaseLifecycle } = await import("@/auth/databaseLifecycle");
    const { notifyConfigPublished } = await import("@/config/publication");
    const { getDatabaseReadiness } = await import("@/auth/databaseReadiness");
    const enabled = KokpitConfigSchema.parse({ schema_version: 2 });
    const disabled = KokpitConfigSchema.parse({ schema_version: 2, auth: { enabled: false } });
    mkdirSync(dbPath);
    expect(() => startDatabaseLifecycle(enabled)).not.toThrow();
    expect(getDatabaseReadiness()).toBe("unavailable");
    expect(errorLog).toHaveBeenCalledTimes(1);
    notifyConfigPublished(enabled);
    await Promise.resolve();
    expect(errorLog).toHaveBeenCalledTimes(1);
    notifyConfigPublished(disabled);
    await Promise.resolve();
    notifyConfigPublished(enabled);
    await Promise.resolve();
    expect(getDatabaseReadiness()).toBe("unavailable");
    expect(errorLog).toHaveBeenCalledTimes(2);
    notifyConfigPublished(enabled);
    await Promise.resolve();
    expect(errorLog).toHaveBeenCalledTimes(2);
  });

  it("recovers from a real startup writer lock with only readiness observations after unlock", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const database = await import("@/auth/db");
    const initialize = vi.spyOn(database, "getDb");
    const { startDatabaseLifecycle } = await import("@/auth/databaseLifecycle");
    const { getDatabaseReadiness } = await import("@/auth/databaseReadiness");
    const holder = new Database(dbPath);
    holder.pragma("journal_mode = WAL");
    holder.exec("BEGIN IMMEDIATE");
    try {
      startDatabaseLifecycle(KokpitConfigSchema.parse({ schema_version: 2 }));
      expect(getDatabaseReadiness()).toBe("unavailable");
      expect(initialize).toHaveBeenCalledTimes(1);
      expect(errorLog.mock.calls).toEqual([["[kokpit] Authentication database initialization failed (SQLITE_BUSY)."]]);
      for (let i = 0; i < 3; i++) expect(getDatabaseReadiness()).toBe("unavailable");
      expect(initialize).toHaveBeenCalledTimes(1);
      holder.exec("ROLLBACK");
      holder.close();
      await vi.waitFor(() => expect(getDatabaseReadiness()).toBe("ready"), { timeout: 2300, interval: 25 });
      expect(initialize).toHaveBeenCalledTimes(2);
      expect(errorLog).toHaveBeenCalledTimes(1);
    } finally {
      if (holder.open) {
        if (holder.inTransaction) holder.exec("ROLLBACK");
        holder.close();
      }
    }
  });

  it.each(["SQLITE_BUSY", "SQLITE_LOCKED"])("bounds background initialization retries for %s", async code => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const database = await import("@/auth/db");
    const initialize = vi.spyOn(database, "getDb").mockImplementation(() => {
      throw Object.assign(new Error("not for logs"), { code });
    });
    const { startDatabaseLifecycle } = await import("@/auth/databaseLifecycle");
    startDatabaseLifecycle(KokpitConfigSchema.parse({ schema_version: 2 }));
    expect(initialize).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect(initialize).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    expect(errorLog).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(initialize).toHaveBeenCalledTimes(3);
  });

  it("replaces pending retries on publication and cancels them for a disabled policy", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const database = await import("@/auth/db");
    const initialize = vi.spyOn(database, "getDb").mockImplementation(() => {
      throw Object.assign(new Error("not for logs"), { code: "SQLITE_BUSY" });
    });
    const { startDatabaseLifecycle } = await import("@/auth/databaseLifecycle");
    const { notifyConfigPublished } = await import("@/config/publication");
    const enabled = KokpitConfigSchema.parse({ schema_version: 2 });
    startDatabaseLifecycle(enabled);
    await vi.advanceTimersByTimeAsync(250);
    notifyConfigPublished(enabled);
    await Promise.resolve();
    expect(initialize).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(250);
    expect(initialize).toHaveBeenCalledTimes(2);
    notifyConfigPublished(KokpitConfigSchema.parse({ schema_version: 2, auth: { enabled: false } }));
    await Promise.resolve();
    await vi.runAllTimersAsync();
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledTimes(1);
    notifyConfigPublished(enabled);
    await Promise.resolve();
    await vi.runAllTimersAsync();
    expect(initialize).toHaveBeenCalledTimes(5);
    expect(errorLog).toHaveBeenCalledTimes(2);
  });

  it("cancels retries on stop and gives a new lifecycle its own bounded budget", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const database = await import("@/auth/db");
    const initialize = vi.spyOn(database, "getDb").mockImplementation(() => {
      throw Object.assign(new Error("not for logs"), { code: "SQLITE_BUSY" });
    });
    const { startDatabaseLifecycle, stopDatabaseLifecycle } = await import("@/auth/databaseLifecycle");
    const enabled = KokpitConfigSchema.parse({ schema_version: 2 });
    startDatabaseLifecycle(enabled);
    stopDatabaseLifecycle();
    await vi.runAllTimersAsync();
    expect(initialize).toHaveBeenCalledTimes(1);
    startDatabaseLifecycle(enabled);
    await vi.runAllTimersAsync();
    expect(initialize).toHaveBeenCalledTimes(4);
  });

  it("checks the auth-disabled override before a scheduled retry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const database = await import("@/auth/db");
    const initialize = vi.spyOn(database, "getDb").mockImplementation(() => {
      throw Object.assign(new Error("not for logs"), { code: "SQLITE_BUSY" });
    });
    const { startDatabaseLifecycle } = await import("@/auth/databaseLifecycle");
    startDatabaseLifecycle(KokpitConfigSchema.parse({ schema_version: 2 }));
    vi.stubEnv("KOKPIT_AUTH_DISABLED", "true");
    await vi.runAllTimersAsync();
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["SQLITE_CANTOPEN", "EACCES"])("does not retry a nontransient initialization failure %s", async code => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const database = await import("@/auth/db");
    const initialize = vi.spyOn(database, "getDb").mockImplementation(() => {
      throw Object.assign(new Error("not for logs"), { code });
    });
    const { startDatabaseLifecycle } = await import("@/auth/databaseLifecycle");
    startDatabaseLifecycle(KokpitConfigSchema.parse({ schema_version: 2 }));
    await vi.runAllTimersAsync();
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
