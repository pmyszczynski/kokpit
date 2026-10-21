// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import Database from "better-sqlite3";

process.env.KOKPIT_DB_PATH = ":memory:";

describe("getDb()", () => {
  it("adds legacy-password guidance metadata without changing existing sessions or challenges", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kokpit-password-hint-migration-"));
    process.env.KOKPIT_DB_PATH = join(dir, "users.db");
    vi.resetModules();
    const { getDb, closeDb } = await import("../../auth/db");
    try {
      const database = getDb();
      const now = Math.floor(Date.now() / 1000);
      database.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES ('user', 'legacy', 'original-hash', ?)").run(Date.now());
      database.prepare("INSERT INTO sessions (id, user_id, token_hash, device, created_at, last_seen_at) VALUES ('session', 'user', 'token-hash', 'Browser', ?, ?)")
        .run(Date.now(), Date.now());
      database.prepare("INSERT INTO totp_challenges (jti, user_id, session_version, issued_at, expires_at) VALUES ('challenge', 'user', 0, ?, ?)")
        .run(now, now + 300);
      // Model the exact preceding schema while retaining live data.
      database.exec("ALTER TABLE sessions DROP COLUMN password_replacement_recommended");
      database.exec("ALTER TABLE totp_challenges DROP COLUMN password_replacement_recommended");
      closeDb();
      const migrated = getDb();
      expect(migrated.prepare("SELECT password_replacement_recommended FROM sessions WHERE id = 'session'").get())
        .toEqual({ password_replacement_recommended: 0 });
      expect(migrated.prepare("SELECT password_replacement_recommended FROM totp_challenges WHERE jti = 'challenge'").get())
        .toEqual({ password_replacement_recommended: 0 });
      expect(migrated.prepare("SELECT password_hash FROM users WHERE id = 'user'").get()).toEqual({ password_hash: "original-hash" });
    } finally {
      closeDb();
      process.env.KOKPIT_DB_PATH = ":memory:";
      rmSync(dir, { recursive: true, force: true });
    }
  });

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

  it("creates the persistent sessions table and user session generation", async () => {
    vi.resetModules();
    const { getDb } = await import("../../auth/db");
    const db = getDb();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get()).toBeTruthy();
    const columns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    expect(columns.some((column) => column.name === "session_version")).toBe(true);
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
      expect(columns.some((c) => c.name === "session_version")).toBe(true);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get()).toBeTruthy();
    } finally {
      process.env.KOKPIT_DB_PATH = ":memory:";
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
