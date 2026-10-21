// @vitest-environment node
import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { buildSync } from "esbuild";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let directory: string;
const children: ChildProcess[] = [];

beforeEach(async () => {
  const { closeDb } = await import("../../auth/db");
  closeDb();
  vi.resetModules();
  directory = mkdtempSync(join(tmpdir(), "kokpit-db-startup-"));
  vi.stubEnv("KOKPIT_DB_PATH", join(directory, "users.db"));
});

afterEach(async () => {
  for (const child of children.splice(0)) child.kill();
  const { closeDb } = await import("../../auth/db");
  closeDb();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

type StartupMessage = { event: string; blocked?: boolean; error?: string };

/** Bound every child handshake so a broken lock or worker cannot hang CI. */
function messageFrom(child: ChildProcess, event: string): Promise<StartupMessage> {
  return new Promise((accept, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onMessage = (message: StartupMessage) => {
      if (message.event === event) { cleanup(); accept(message); }
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onExit = (code: number | null) => onError(new Error(`Startup worker exited before ${event}: ${code}`));
    const timer = setTimeout(() => onError(new Error(`Startup worker timed out waiting for ${event}`)), 5_000);
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

describe("database initialization", () => {
  it.each([false, true])("serializes two real startup processes and preserves live records (older user columns=%s)", async olderUsers => {
    const { getDb, closeDb } = await import("../../auth/db");
    const database = getDb();
    const now = Math.floor(Date.now() / 1000);
    database.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES ('user', 'legacy', 'unchanged-hash', ?)").run(Date.now());
    database.prepare("INSERT INTO sessions (id, user_id, token_hash, device, created_at, last_seen_at) VALUES ('session', 'user', 'opaque-token-hash', 'Browser', 123, 456)").run();
    database.prepare("INSERT INTO totp_challenges (jti, user_id, session_version, issued_at, expires_at) VALUES ('challenge', 'user', 0, ?, ?)").run(now, now + 300);
    database.exec("ALTER TABLE sessions DROP COLUMN password_replacement_recommended");
    database.exec("ALTER TABLE totp_challenges DROP COLUMN password_replacement_recommended");
    if (olderUsers) {
      database.exec("ALTER TABLE users DROP COLUMN recovery_code_hash");
      database.exec("ALTER TABLE users DROP COLUMN session_version");
    }
    closeDb();

    const bundle = join(directory, "db.cjs");
    buildSync({ entryPoints: [resolve("src/auth/db.ts")], outfile: bundle, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent" });
    const worker = join(directory, "startup.cjs");
    const release = join(directory, "release-first");
    writeFileSync(worker, `const fs = require('node:fs');
const Database = require('better-sqlite3');
const original = Database.prototype.prepare;
Database.prototype.prepare = function(sql) {
  const statement = original.call(this, sql);
  if (process.env.PAUSE_SCHEMA_READ === 'true' && sql === 'PRAGMA table_info(sessions)') {
    const all = statement.all.bind(statement);
    statement.all = function(...args) {
      const rows = all(...args);
      process.send({event: 'inspected'});
      const deadline = Date.now() + 4000;
      while (!fs.existsSync(process.env.RELEASE_SCHEMA_READ)) {
        if (Date.now() >= deadline) throw new Error('Parent did not release schema read');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
      return rows;
    };
  }
  return statement;
};
process.once('message', () => {
  try {
    if (process.env.PAUSE_SCHEMA_READ !== 'true') {
      // The first initializer is paused after reading the old schema. Verify
      // its write lock from this independent process before starting ours.
      const probe = new Database(process.env.KOKPIT_DB_PATH, {timeout: 0});
      let blocked = false;
      try { probe.exec('BEGIN IMMEDIATE'); probe.exec('ROLLBACK'); }
      catch (error) { if (error.code !== 'SQLITE_BUSY') throw error; blocked = true; }
      finally { probe.close(); }
      process.send({event: 'probe', blocked});
    }
    const {getDb, closeDb} = require(process.env.DB_BUNDLE);
    getDb(); closeDb(); process.send({event: 'result'});
  } catch (error) { process.send({event: 'result', error: error.message}); }
  process.disconnect();
});
process.send({event: 'ready'});
`);
    const require = createRequire(join(process.cwd(), "package.json"));
    const env = { ...process.env, NODE_PATH: dirname(dirname(require.resolve("better-sqlite3/package.json"))), DB_BUNDLE: bundle, RELEASE_SCHEMA_READ: release };
    const first = fork(worker, [], { env: { ...env, PAUSE_SCHEMA_READ: "true" }, stdio: ["ignore", "ignore", "inherit", "ipc"] });
    const second = fork(worker, [], { env, stdio: ["ignore", "ignore", "inherit", "ipc"] });
    children.push(first, second);
    await Promise.all([messageFrom(first, "ready"), messageFrom(second, "ready")]);
    const inspected = messageFrom(first, "inspected");
    const probe = messageFrom(second, "probe");
    const firstResult = messageFrom(first, "result");
    const secondResult = messageFrom(second, "result");
    // Observe worker failures below even if an earlier handshake fails first.
    void firstResult.catch(() => {}); void secondResult.catch(() => {}); void probe.catch(() => {});
    first.send("start");
    await inspected;
    second.send("start");
    const lock = await probe;
    writeFileSync(release, "continue");
    const outcomes = await Promise.all([firstResult, secondResult]);
    expect(lock.blocked).toBe(true);
    expect(outcomes).toEqual([{ event: "result" }, { event: "result" }]);
    const migrated = getDb();
    expect(migrated.prepare("SELECT password_hash, recovery_code_hash, session_version FROM users").get())
      .toEqual({ password_hash: "unchanged-hash", recovery_code_hash: null, session_version: 0 });
    expect(migrated.prepare("SELECT token_hash, created_at, last_seen_at, password_replacement_recommended FROM sessions").get())
      .toEqual({ token_hash: "opaque-token-hash", created_at: 123, last_seen_at: 456, password_replacement_recommended: 0 });
    expect(migrated.prepare("SELECT jti, state, attempts, expires_at, password_replacement_recommended FROM totp_challenges").get())
      .toEqual({ jti: "challenge", state: "active", attempts: 0, expires_at: now + 300, password_replacement_recommended: 0 });
  }, 15_000);

  it("rolls back failed initialization, closes its handle and retries without caching partial schema", async () => {
    const malformed = new Database(process.env.KOKPIT_DB_PATH!);
    malformed.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, totp_secret TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY);`);
    malformed.close();
    const close = vi.spyOn(Database.prototype, "close");
    const { getDb } = await import("../../auth/db");
    expect(() => getDb()).toThrow("no such column: user_id");
    expect(close).toHaveBeenCalledTimes(1);
    const failed = close.mock.contexts[0] as Database.Database;
    expect(failed.open).toBe(false);

    const repair = new Database(process.env.KOKPIT_DB_PATH!);
    try {
      expect((repair.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map(column => column.name))
        .not.toContain("recovery_code_hash");
      expect((repair.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map(column => column.name))
        .not.toContain("session_version");
      repair.exec("DROP TABLE sessions");
    } finally { repair.close(); }
    // No closeDb() reset: retry must create and fully initialize a fresh handle.
    const retried = getDb();
    expect(retried).not.toBe(failed);
    expect(retried.open).toBe(true);
    expect(retried.prepare("SELECT recovery_code_hash, session_version FROM users").all()).toEqual([]);
    expect(retried.prepare("SELECT password_replacement_recommended FROM sessions").all()).toEqual([]);
    expect(retried.prepare("SELECT password_replacement_recommended FROM totp_challenges").all()).toEqual([]);
    expect(getDb()).toBe(retried);
  });
});
