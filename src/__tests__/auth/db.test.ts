// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";

process.env.KOKPIT_DB_PATH = ":memory:";

describe("getDb()", () => {
  it("creates the users table on first call", async () => {
    vi.resetModules();
    const { getDb } = await import("../../auth/db");
    const db = getDb();
    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
      )
      .get();
    expect(table).toBeTruthy();
  });

  it("returns the same instance on subsequent calls", async () => {
    vi.resetModules();
    const { getDb } = await import("../../auth/db");
    expect(getDb()).toBe(getDb());
  });

  it("creates users with a recovery_code_hash column", async () => {
    vi.resetModules();
    const { getDb } = await import("../../auth/db");
    const db = getDb();
    const columns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    expect(columns.some((c) => c.name === "recovery_code_hash")).toBe(true);
    expect(columns.some((c) => c.name === "session_version")).toBe(true);
  });

  it("migrates an existing DB that predates the recovery_code_hash column", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kokpit-db-test-"));
    const dbPath = join(dir, "users.db");
    try {
      const legacyDb = new Database(dbPath);
      legacyDb.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          totp_secret TEXT,
          created_at INTEGER NOT NULL
        )
      `);
      legacyDb
        .prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?)")
        .run("legacy-user", "legacy", "hash", null, Date.now());
      legacyDb.close();

      process.env.KOKPIT_DB_PATH = dbPath;
      vi.resetModules();
      const { getDb } = await import("../../auth/db");
      const db = getDb();
      const columns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
      expect(columns.some((c) => c.name === "recovery_code_hash")).toBe(true);
      expect(columns.some((c) => c.name === "session_version")).toBe(true);
      expect(
        (db.prepare("SELECT session_version FROM users WHERE id = ?").get("legacy-user") as { session_version: number }).session_version
      ).toBe(0);
    } finally {
      process.env.KOKPIT_DB_PATH = ":memory:";
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not cache a connection when initialization fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kokpit-db-test-"));
    const dbPath = join(dir, "users.db");
    try {
      const invalidDb = new Database(dbPath);
      invalidDb.exec("CREATE VIEW users AS SELECT 1 AS id");
      invalidDb.close();

      process.env.KOKPIT_DB_PATH = dbPath;
      vi.resetModules();
      const { closeDb, getDb } = await import("../../auth/db");
      expect(() => getDb()).toThrow();

      const repairedDb = new Database(dbPath);
      repairedDb.exec("DROP VIEW users");
      repairedDb.close();

      expect(() => getDb()).not.toThrow();
      closeDb();
    } finally {
      process.env.KOKPIT_DB_PATH = ":memory:";
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("holds a write lock throughout a legacy database migration", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kokpit-db-test-"));
    const dbPath = join(dir, "users.db");
    try {
      const legacyDb = new Database(dbPath);
      legacyDb.exec(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          totp_secret TEXT,
          created_at INTEGER NOT NULL
        )
      `);
      legacyDb
        .prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?)")
        .run("legacy-user", "legacy", "hash", null, Date.now());
      legacyDb.close();

      const competingDb = new Database(dbPath, { timeout: 0 });
      const originalPrepare = Database.prototype.prepare;
      const prepareSpy = vi.spyOn(Database.prototype, "prepare").mockImplementation(function (this: Database.Database, source: string) {
        if (source === "PRAGMA table_info(users)") {
          expect(() => competingDb.exec("ALTER TABLE users ADD COLUMN competing_migration TEXT")).toThrow(/database is locked/);
        }
        return originalPrepare.call(this, source);
      });
      try {
        process.env.KOKPIT_DB_PATH = dbPath;
        vi.resetModules();
        const { closeDb, getDb } = await import("../../auth/db");
        getDb();
        closeDb();
      } finally {
        prepareSpy.mockRestore();
        competingDb.close();
      }
    } finally {
      process.env.KOKPIT_DB_PATH = ":memory:";
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
