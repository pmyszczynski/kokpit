// @vitest-environment node
import { mkdtempSync, rmSync } from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import { join } from "path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirectories: string[] = [];
const requireFromHere = createRequire(import.meta.url);
const initialDbPath = process.env.KOKPIT_DB_PATH;

afterEach(async () => {
  const { closeDb } = await import("@/auth");
  closeDb();
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  if (initialDbPath === undefined) delete process.env.KOKPIT_DB_PATH;
  else process.env.KOKPIT_DB_PATH = initialDbPath;
  vi.resetModules();
});

describe("reset-password script database initialization", () => {
  it("creates the application-compatible sessions schema before the app opens the database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kokpit-reset-password-"));
    tempDirectories.push(directory);
    process.env.KOKPIT_DB_PATH = join(directory, "users.db");

    const script = requireFromHere("../../../scripts/reset-password.js") as {
      openDb(): Database.Database;
    };
    const db = script.openDb();
    const columns = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[])
      .map((column) => column.name);
    const index = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get("sessions_user_id_idx");
    expect(columns).toEqual(expect.arrayContaining([
      "id", "user_id", "token_hash", "device", "created_at", "last_seen_at", "idle_timeout_hours",
    ]));
    expect(index).toBeDefined();
    db.close();

    const { createSession, createUser } = await import("@/auth");
    const user = await createUser("script-migration", "hash");
    expect(() => createSession(user.id)).not.toThrow();
  });
});
