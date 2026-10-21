// @vitest-environment node
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { buildSync } from "esbuild";
import { generateSync } from "otplib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TotpChallengeClaims } from "../../auth/totpChallengeStore";

let directory: string;
const connections: Database.Database[] = [];
const children: ChildProcess[] = [];

beforeEach(async () => {
  const { closeDb } = await import("../../auth/db"); closeDb();
  vi.resetModules();
  directory = mkdtempSync(path.join(os.tmpdir(), "kokpit-totp-store-"));
  vi.stubEnv("KOKPIT_DB_PATH", path.join(directory, "users.db"));
  vi.stubEnv("KOKPIT_SESSION_SECRET", "test-secret-32-chars-minimum-length-xx");
});

afterEach(async () => {
  for (const child of children.splice(0)) child.kill();
  for (const connection of connections.splice(0)) if (connection.open) connection.close();
  const { closeDb } = await import("../../auth/db"); closeDb();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

async function fixture(username = "challenge-user") {
  const users = await import("../../auth/users");
  const { generateTotpSecret } = await import("../../auth/totp");
  const { getDb } = await import("../../auth/db");
  const store = await import("../../auth/totpChallengeStore");
  const user = await users.createUser(username, "test-hash");
  const secret = generateTotpSecret(); users.setTotpSecret(user.id, secret);
  const currentUser = users.getUserById(user.id)!;
  const issuedAt = Math.floor(Date.now() / 1000);
  const claims: TotpChallengeClaims = { jti: randomUUID(), userId: user.id, sessionVersion: currentUser.sessionVersion, issuedAt, expiresAt: issuedAt + 300 };
  store.registerTotpChallenge(claims);
  const code = generateSync({ secret });
  return { ...store, claims, user: currentUser, secret, code, wrongCode: code === "000000" ? "999999" : "000000", db: getDb() };
}

function independentConnection(): Database.Database {
  const db = new Database(path.join(directory, "users.db"));
  db.pragma("journal_mode = WAL"); connections.push(db); return db;
}

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

describe("durable TOTP challenge lifecycle", () => {
  it("persists four failures across reopen and exhausts the fifth from another connection", async () => {
    const test = await fixture();
    for (let i = 0; i < 4; i++) expect(test.completeTotpChallenge(test.claims, test.wrongCode).status).toBe("wrong");
    const { closeDb, getDb } = await import("../../auth/db"); closeDb();
    const reopened = getDb();
    expect(reopened.prepare("SELECT attempts, state, expires_at FROM totp_challenges WHERE jti = ?").get(test.claims.jti)).toEqual({ attempts: 4, state: "active", expires_at: test.claims.expiresAt });
    expect(test.completeTotpChallenge(test.claims, test.wrongCode, {}, independentConnection()).status).toBe("exhausted");
    expect(test.completeTotpChallenge(test.claims, test.code).status).toBe("invalid");
    expect(reopened.prepare("SELECT attempts, state FROM totp_challenges WHERE jti = ?").get(test.claims.jti)).toEqual({ attempts: 5, state: "exhausted" });
    expect(count(reopened, "sessions")).toBe(0);
  });

  it("consumes once across independent connections and database reopen", async () => {
    const test = await fixture();
    const other = independentConnection();
    const result = test.completeTotpChallenge(test.claims, test.code, { idleTimeoutHours: 12, userAgent: "Mozilla/5.0 Firefox/100.0 Linux" }, other);
    expect(result.status).toBe("success");
    expect(test.isRegisteredTotpChallenge(test.claims)).toBe(false);
    expect(test.completeTotpChallenge(test.claims, test.code).status).toBe("invalid");
    const { closeDb, getDb } = await import("../../auth/db"); closeDb();
    expect(test.completeTotpChallenge(test.claims, test.code).status).toBe("invalid");
    expect(count(getDb(), "sessions")).toBe(1);
    expect(getDb().prepare("SELECT idle_timeout_hours, device FROM sessions").get()).toEqual({ idle_timeout_hours: 12, device: "Firefox on Linux" });
    expect(count(getDb(), "login_request_times")).toBe(1);
    expect(getDb().prepare("SELECT attempts FROM login_rate_limits").get()).toEqual({ attempts: 0 });
  });

  it.each(["user", "generation", "expiry", "issued-at"])("rejects mismatched %s claims without spending attempts", async mismatch => {
    const test = await fixture();
    const claims = { ...test.claims };
    if (mismatch === "user") claims.userId = "other-user";
    if (mismatch === "generation") claims.sessionVersion++;
    if (mismatch === "expiry") claims.expiresAt++;
    if (mismatch === "issued-at") claims.issuedAt--;
    expect(test.isRegisteredTotpChallenge(claims)).toBe(false);
    expect(test.completeTotpChallenge(claims, test.code).status).toBe("invalid");
    expect(test.db.prepare("SELECT attempts, state FROM totp_challenges").get()).toEqual({ attempts: 0, state: "active" });
    expect(count(test.db, "login_request_times")).toBe(0);
  });

  it("rechecks credential generation inside the transaction", async () => {
    const test = await fixture();
    const { updatePasswordHash } = await import("../../auth/users");
    updatePasswordHash(test.user.id, "replacement-hash");
    expect(test.completeTotpChallenge(test.claims, test.code, {}, independentConnection()).status).toBe("invalid");
    expect(count(test.db, "sessions")).toBe(0);
  });

  it("rolls session insertion, challenge consumption, and limiter reservations back together", async () => {
    const test = await fixture();
    test.db.exec("CREATE TRIGGER fail_session_insert BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'synthetic insertion failure'); END;");
    expect(() => test.completeTotpChallenge(test.claims, test.code)).toThrow("synthetic insertion failure");
    expect(test.db.prepare("SELECT attempts, state FROM totp_challenges").get()).toEqual({ attempts: 0, state: "active" });
    expect(count(test.db, "sessions")).toBe(0);
    expect(count(test.db, "login_rate_limits")).toBe(0);
    expect(count(test.db, "login_request_times")).toBe(0);
    test.db.exec("DROP TRIGGER fail_session_insert");
    expect(test.completeTotpChallenge(test.claims, test.code).status).toBe("success");
    expect(count(test.db, "sessions")).toBe(1);
  });

  it("keeps durable account budgets across fresh challenges and reopen", async () => {
    const test = await fixture();
    for (let i = 0; i < 10; i++) {
      const claims = i === 0 ? test.claims : { ...test.claims, jti: randomUUID() };
      if (i > 0) test.registerTotpChallenge(claims);
      expect(test.completeTotpChallenge(claims, test.wrongCode).status).toBe("wrong");
    }
    const { closeDb } = await import("../../auth/db"); closeDb();
    const next = { ...test.claims, jti: randomUUID() }; test.registerTotpChallenge(next);
    expect(test.completeTotpChallenge(next, test.code)).toMatchObject({ status: "limited", retryAfterSeconds: expect.any(Number) });
  });

  it("does not erase prior account failures when another challenge succeeds", async () => {
    const test = await fixture();
    expect(test.completeTotpChallenge(test.claims, test.wrongCode).status).toBe("wrong");
    const next = { ...test.claims, jti: randomUUID() }; test.registerTotpChallenge(next);
    expect(test.completeTotpChallenge(next, test.code).status).toBe("success");
    expect(test.db.prepare("SELECT attempts FROM login_rate_limits").get()).toEqual({ attempts: 1 });
    expect(count(test.db, "login_request_times")).toBe(2);
  });

  it("retains the shared rolling admission budget across restart without spending a challenge attempt", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    const test = await fixture();
    const insert = test.db.prepare("INSERT INTO login_request_times (requested_at) VALUES (?)");
    test.db.transaction(() => { for (let i = 0; i < 100; i++) insert.run(Date.now()); })();
    expect(test.completeTotpChallenge(test.claims, test.code)).toEqual({ status: "limited", retryAfterSeconds: 60 });
    expect(test.db.prepare("SELECT attempts, state FROM totp_challenges").get()).toEqual({ attempts: 0, state: "active" });
    const { closeDb, getDb } = await import("../../auth/db"); closeDb();
    expect(test.completeTotpChallenge(test.claims, test.code)).toEqual({ status: "limited", retryAfterSeconds: 60 });
    expect(count(getDb(), "sessions")).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(test.completeTotpChallenge(test.claims, generateSync({ secret: test.secret })).status).toBe("success");
    expect(count(getDb(), "login_request_times")).toBe(1);
  });

  it("rejects at the fixed expiry without extending it after failures", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    const test = await fixture();
    vi.advanceTimersByTime(299_000);
    expect(test.completeTotpChallenge(test.claims, test.wrongCode).status).toBe("wrong");
    vi.advanceTimersByTime(1000);
    expect(test.completeTotpChallenge(test.claims, test.code).status).toBe("invalid");
    expect(test.isRegisteredTotpChallenge(test.claims)).toBe(false);
    expect(count(test.db, "sessions")).toBe(0);
  });
});

describe("challenge admission bounds", () => {
  it("cleans expired rows on startup while retaining unrelated live challenges", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    const first = await fixture();
    vi.advanceTimersByTime(1000);
    const other = await fixture("later-user");
    vi.advanceTimersByTime(299_000);
    const { closeDb, getDb } = await import("../../auth/db"); closeDb();
    expect(count(getDb(), "totp_challenges")).toBe(1);
    expect(first.isRegisteredTotpChallenge(first.claims)).toBe(false);
    expect(other.isRegisteredTotpChallenge(other.claims)).toBe(true);
  });

  it("refuses a seventeenth active challenge without evicting live challenges", async () => {
    const test = await fixture();
    for (let i = 1; i < 16; i++) test.registerTotpChallenge({ ...test.claims, jti: randomUUID() });
    expect(() => test.registerTotpChallenge({ ...test.claims, jti: randomUUID() })).toThrowError(expect.objectContaining({ name: "TotpChallengeCapacityError", retryAfterSeconds: expect.any(Number) }));
    expect(count(test.db, "totp_challenges")).toBe(16);
    expect(test.isRegisteredTotpChallenge(test.claims)).toBe(true);
    const unrelated = await fixture("other-user");
    expect(unrelated.isRegisteredTotpChallenge(unrelated.claims)).toBe(true);
    expect(test.isRegisteredTotpChallenge(test.claims)).toBe(true);
  });

  it("bounds total unexpired rows and allows admission after expiry cleanup", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    const test = await fixture();
    const insert = test.db.prepare("INSERT INTO totp_challenges (jti, user_id, session_version, issued_at, expires_at, attempts, state) VALUES (?, ?, ?, ?, ?, 0, 'consumed')");
    test.db.transaction(() => {
      for (let i = 1; i < 1024; i++) insert.run(randomUUID(), test.user.id, test.user.sessionVersion, test.claims.issuedAt, test.claims.expiresAt);
    })();
    expect(() => test.registerTotpChallenge({ ...test.claims, jti: randomUUID() })).toThrowError(expect.objectContaining({ name: "TotpChallengeCapacityError" }));
    expect(count(test.db, "totp_challenges")).toBe(1024);
    vi.advanceTimersByTime(300_000);
    const issuedAt = Math.floor(Date.now() / 1000);
    test.registerTotpChallenge({ ...test.claims, jti: randomUUID(), issuedAt, expiresAt: issuedAt + 300 });
    expect(count(test.db, "totp_challenges")).toBe(1);
  });
});

async function spawnClaimant(bundle: string): Promise<ChildProcess> {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const nodePath = path.dirname(path.dirname(require.resolve("better-sqlite3/package.json")));
  const script = path.join(directory, `claim-${randomUUID()}.cjs`);
  writeFileSync(script, `const { completeTotpChallenge } = require(${JSON.stringify(bundle)});
process.on('message', ({ claims, code, now }) => {
  Date.now = () => now;
  try { process.send({ status: completeTotpChallenge(claims, code).status }); }
  catch (error) { process.send({ error: error.message }); }
  process.disconnect();
});
process.send({ ready: true });\n`);
  const child = fork(script, [], { env: { ...process.env, NODE_PATH: nodePath }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  children.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once("message", message => (message as { ready?: boolean }).ready ? resolve() : reject(new Error("Unexpected claimant startup")));
    child.once("error", reject);
    child.once("exit", code => { if (code) reject(new Error(`Claimant failed to start: ${code}`)); });
  });
  return child;
}

function submit(child: ChildProcess, claims: TotpChallengeClaims, code: string, now: number): Promise<string> {
  return new Promise((resolve, reject) => {
    child.once("message", message => {
      const result = message as { status?: string; error?: string };
      if (result.error) reject(new Error(result.error)); else resolve(result.status!);
    });
    child.once("error", reject);
    child.send({ claims, code, now });
  });
}

describe("independent process challenge claims", () => {
  it.each([false, true])("serializes concurrent valid submission against fifth failure=%s", async withFailure => {
    const test = await fixture();
    if (withFailure) for (let i = 0; i < 4; i++) test.completeTotpChallenge(test.claims, test.wrongCode);
    const bundle = path.join(directory, "store.cjs");
    buildSync({ entryPoints: [path.resolve("src/auth/totpChallengeStore.ts")], outfile: bundle, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent" });
    const claimants = await Promise.all([spawnClaimant(bundle), spawnClaimant(bundle)]);
    const now = Date.now();
    const code = generateSync({ secret: test.secret });
    const wrongCode = code === "000000" ? "999999" : "000000";
    const outcomes = await Promise.all([
      submit(claimants[0], test.claims, code, now),
      submit(claimants[1], test.claims, withFailure ? wrongCode : code, now),
    ]);
    if (!withFailure) expect(outcomes.sort()).toEqual(["invalid", "success"]);
    else expect([["success", "invalid"], ["invalid", "exhausted"]]).toContainEqual(outcomes);
    expect(count(test.db, "sessions")).toBe(outcomes.includes("success") ? 1 : 0);
    const row = test.db.prepare("SELECT attempts, state FROM totp_challenges WHERE jti = ?").get(test.claims.jti) as { attempts: number; state: string };
    expect(row.attempts).toBeLessThanOrEqual(5);
    expect(row.state).toBe(outcomes.includes("success") ? "consumed" : "exhausted");
  });
});
