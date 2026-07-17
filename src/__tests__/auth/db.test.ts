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
      legacyDb.close();

      process.env.KOKPIT_DB_PATH = dbPath;
      vi.resetModules();
      const { getDb } = await import("../../auth/db");
      const db = getDb();
      const columns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
      expect(columns.some((c) => c.name === "recovery_code_hash")).toBe(true);
    } finally {
      process.env.KOKPIT_DB_PATH = ":memory:";
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
