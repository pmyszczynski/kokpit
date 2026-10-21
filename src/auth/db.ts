import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const path = process.env.KOKPIT_DB_PATH ?? "data/users.db";
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      totp_secret TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  const columns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "recovery_code_hash")) {
    db.exec("ALTER TABLE users ADD COLUMN recovery_code_hash TEXT");
  }
  if (!columns.some((c) => c.name === "session_version")) {
    db.exec("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      device TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      idle_timeout_hours INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS login_rate_limits (
      key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS login_rate_limits_expiry_idx ON login_rate_limits(expires_at);
    CREATE TABLE IF NOT EXISTS login_request_times (
      id INTEGER PRIMARY KEY,
      requested_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS login_request_times_time_idx ON login_request_times(requested_at);
    CREATE TABLE IF NOT EXISTS totp_challenges (
      jti TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_version INTEGER NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
      state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'consumed', 'exhausted')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS totp_challenges_expiry_idx ON totp_challenges(expires_at);
    CREATE INDEX IF NOT EXISTS totp_challenges_user_state_idx ON totp_challenges(user_id, state, expires_at);
  `);
  db.prepare("DELETE FROM totp_challenges WHERE expires_at <= ?").run(Math.floor(Date.now() / 1000));

  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
