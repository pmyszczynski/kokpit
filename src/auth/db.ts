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

  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
