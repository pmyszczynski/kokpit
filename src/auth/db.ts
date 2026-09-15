import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const path = process.env.KOKPIT_DB_PATH ?? "data/users.db";
  mkdirSync(dirname(path), { recursive: true });
  const connection = new Database(path);

  try {
    connection.pragma("journal_mode = WAL");
    connection.exec("BEGIN IMMEDIATE");
    try {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          totp_secret TEXT,
          session_version INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        )
      `);

      const columns = connection.prepare("PRAGMA table_info(users)").all() as { name: string }[];
      if (!columns.some((c) => c.name === "recovery_code_hash")) {
        connection.exec("ALTER TABLE users ADD COLUMN recovery_code_hash TEXT");
      }
      if (!columns.some((c) => c.name === "session_version")) {
        connection.exec("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0");
      }
      connection.exec("COMMIT");
    } catch (error) {
      try {
        connection.exec("ROLLBACK");
      } catch {}
      throw error;
    }

    db = connection;
    return db;
  } catch (error) {
    connection.close();
    throw error;
  }
}

export function closeDb(): void {
  db?.close();
  db = null;
}
