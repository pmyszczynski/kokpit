// @vitest-environment node
import { mkdtempSync, mkdirSync, existsSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let directory: string;
let dbPath: string;
const handles: Database.Database[] = [];
beforeEach(async () => {
  (await import("@/auth/db")).closeDb();
  vi.resetModules();
  directory = mkdtempSync(path.join(os.tmpdir(), "kokpit-db-readiness-"));
  dbPath = path.join(directory, "state", "users.db");
  vi.stubEnv("KOKPIT_DB_PATH", dbPath);
});
afterEach(async () => {
  for (const handle of handles.splice(0)) if (handle.open) handle.close();
  (await import("@/auth/db")).closeDb();
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("database readiness observation", () => {
  it("does not create directories or a database while uninitialized", async () => {
    const { getDatabaseReadiness } = await import("@/auth/databaseReadiness");
    expect(getDatabaseReadiness()).toBe("initializing");
    expect(getDatabaseReadiness()).toBe("initializing");
    expect(existsSync(path.dirname(dbPath))).toBe(false);
  });

  it("accepts initialized first-run schema without requiring an account", async () => {
    const { getDb } = await import("@/auth/db");
    const { getDatabaseReadiness } = await import("@/auth/databaseReadiness");
    const db = getDb();
    expect(db.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 0 });
    expect(getDatabaseReadiness()).toBe("ready");
    expect(db.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 0 });
  });

  it("records initialization failure without retrying from a probe", async () => {
    mkdirSync(dbPath, { recursive: true });
    const { getDb } = await import("@/auth/db");
    const { getDatabaseReadiness } = await import("@/auth/databaseReadiness");
    expect(() => getDb()).toThrow();
    expect(getDatabaseReadiness()).toBe("unavailable");
    expect(getDatabaseReadiness()).toBe("unavailable");
    rmSync(dbPath, { recursive: true });
    expect(getDatabaseReadiness()).toBe("unavailable");
    expect(existsSync(dbPath)).toBe(false);
    getDb();
    expect(getDatabaseReadiness()).toBe("ready");
  });

  it("records directory creation failures and retries only through initialization", async () => {
    writeFileSync(path.dirname(dbPath), "file blocks the DB directory");
    const { getDb } = await import("@/auth/db");
    const { getDatabaseReadiness } = await import("@/auth/databaseReadiness");
    expect(() => getDb()).toThrow();
    expect(getDatabaseReadiness()).toBe("unavailable");
    unlinkSync(path.dirname(dbPath));
    expect(getDatabaseReadiness()).toBe("unavailable");
    expect(existsSync(dbPath)).toBe(false);
    getDb();
    expect(getDatabaseReadiness()).toBe("ready");
  });

  it("detects a closed handle without reopening it", async () => {
    const { getDb, closeDb } = await import("@/auth/db");
    const { getDatabaseReadiness } = await import("@/auth/databaseReadiness");
    const db = getDb(); closeDb();
    expect(getDatabaseReadiness()).toBe("unavailable");
    expect(db.open).toBe(false);
  });

  it("refuses a readonly connection even though its schema can be read", async () => {
    const { getDb, closeDb } = await import("@/auth/db"); getDb(); closeDb();
    const readonly = new Database(dbPath, { readonly: true }); handles.push(readonly);
    const { recordDatabaseInitialized, getDatabaseReadiness } = await import("@/auth/databaseReadiness");
    recordDatabaseInitialized(readonly);
    expect(getDatabaseReadiness()).toBe("unavailable");
  });

  it("detects query-only mode and recovers without writes", async () => {
    const { getDb } = await import("@/auth/db"); const db = getDb();
    const { getDatabaseReadiness } = await import("@/auth/databaseReadiness");
    db.pragma("query_only = ON"); expect(getDatabaseReadiness()).toBe("unavailable");
    db.pragma("query_only = OFF"); expect(getDatabaseReadiness()).toBe("ready");
  });

  it("detects missing session schema without repairing or recreating it", async () => {
    const { getDb } = await import("@/auth/db"); const db = getDb();
    const { getDatabaseReadiness } = await import("@/auth/databaseReadiness");
    db.exec("DROP TABLE sessions");
    expect(getDatabaseReadiness()).toBe("unavailable");
    expect(getDatabaseReadiness()).toBe("unavailable");
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='sessions'").get()).toBeUndefined();
  });

  it("rejects a missing challenge table without recreating it", async () => {
    const { getDb } = await import("@/auth/db"); const db = getDb();
    const { getDatabaseReadiness } = await import("@/auth/databaseReadiness");
    db.exec("DROP TABLE totp_challenges");
    expect(getDatabaseReadiness()).toBe("unavailable");
    expect(getDatabaseReadiness()).toBe("unavailable");
    expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='totp_challenges'").get()).toBeUndefined();
  });

  it.each([
    ...["id", "username", "password_hash", "totp_secret", "created_at", "recovery_code_hash", "session_version"]
      .map(column => ["users", column]),
    ...["id", "user_id", "token_hash", "device", "created_at", "last_seen_at", "idle_timeout_hours", "password_replacement_recommended"]
      .map(column => ["sessions", column]),
    ...["jti", "user_id", "session_version", "issued_at", "expires_at", "attempts", "state", "password_replacement_recommended"]
      .map(column => ["totp_challenges", column]),
    ...["key", "attempts", "expires_at"].map(column => ["login_rate_limits", column]),
    ...["id", "requested_at"].map(column => ["login_request_times", column]),
  ])("rejects missing required %s.%s without repairing it", async (table, column) => {
    const { getDb } = await import("@/auth/db"); const db = getDb();
    const { getDatabaseReadiness } = await import("@/auth/databaseReadiness");
    // Renaming also exercises indexed/primary-key columns that SQLite will
    // not let a test simply drop. The application's original column is gone.
    db.exec(`ALTER TABLE ${table} RENAME COLUMN ${column} TO missing_${column}`);
    expect(getDatabaseReadiness()).toBe("unavailable");
    expect(getDatabaseReadiness()).toBe("unavailable");
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    expect(columns.some(entry => entry.name === column)).toBe(false);
    expect(columns.some(entry => entry.name === `missing_${column}`)).toBe(true);
  });

  it("bounds lock waiting and restores the application's original busy timeout", async () => {
    const { getDb } = await import("@/auth/db"); const db = getDb();
    const { getDatabaseReadiness } = await import("@/auth/databaseReadiness");
    db.pragma("journal_mode = DELETE"); db.pragma("busy_timeout = 5000");
    const blocker = new Database(dbPath); handles.push(blocker); blocker.exec("BEGIN EXCLUSIVE");
    try {
      const started = performance.now();
      expect(getDatabaseReadiness()).toBe("unavailable");
      // Wide margin: detects accidentally retaining SQLite's five-second
      // timeout without treating the exact 50ms wait as a performance promise.
      expect(performance.now() - started).toBeLessThan(2000);
      expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
    } finally { blocker.exec("ROLLBACK"); }
    expect(getDatabaseReadiness()).toBe("ready");
  });
});
