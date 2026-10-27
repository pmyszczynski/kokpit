import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "./db";

const ACCOUNT_LIMIT = 10;
const ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_LIMIT = 100;
const GLOBAL_WINDOW_MS = 60 * 1000;
const RECOVERY_WINDOW_MS = 60 * 60 * 1000;

type Counter = { attempts: number; expires_at: number };
type LoginAttempt = { key: string; expiresAt: number };
type Decision =
  | { allowed: true; attempt: LoginAttempt }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Reserve before bcrypt yields, including for unknown accounts. SQLite shares
 * the budget across processes and restarts. The global budget bounds username
 * rotation and stored counters without trusting caller-supplied proxy headers.
 */
export function reserveLoginAttempt(username: string): Decision {
  return reserveAttempt(`account:${createHash("sha256").update(username.toLowerCase()).digest("hex")}`);
}

/** Login challenges and 2FA removal share the same account's TOTP allowance. */
export function reserveTotpAttempt(userId: string, db: Database.Database = getDb()): Decision {
  return reserveAttempt(`totp:${createHash("sha256").update(userId).digest("hex")}`, db);
}

/** Recovery shares the global budget and never retains raw submitted usernames. */
export function reserveRecoveryAttempt(username: string): Decision {
  return reserveAttempt(
    `recovery:${createHash("sha256").update(username.toLowerCase()).digest("hex")}`,
    getDb(),
    RECOVERY_WINDOW_MS
  );
}

function reserveAttempt(key: string, db: Database.Database = getDb(), accountWindowMs = ACCOUNT_WINDOW_MS): Decision {
  // better-sqlite3 uses a savepoint when the challenge transaction already
  // owns this connection. Its limiter writes then commit/roll back together.
  return db.transaction((): Decision => {
    const now = Date.now();
    db.prepare("DELETE FROM login_rate_limits WHERE expires_at <= ?").run(now);
    db.prepare("DELETE FROM login_request_times WHERE requested_at <= ?").run(now - GLOBAL_WINDOW_MS);
    const read = db.prepare("SELECT attempts, expires_at FROM login_rate_limits WHERE key = ?");
    const account = read.get(key) as Counter | undefined;
    const shared = db.prepare("SELECT COUNT(*) AS count, MIN(requested_at) AS oldest FROM login_request_times")
      .get() as { count: number; oldest: number | null };
    const blockedUntil = Math.max(
      account && account.attempts >= ACCOUNT_LIMIT ? account.expires_at : 0,
      shared.count >= GLOBAL_LIMIT ? shared.oldest! + GLOBAL_WINDOW_MS : 0
    );
    if (blockedUntil > now) {
      return { allowed: false, retryAfterSeconds: Math.ceil((blockedUntil - now) / 1000) };
    }
    const expiresAt = account?.expires_at ?? now + accountWindowMs;
    const increment = db.prepare(`
      INSERT INTO login_rate_limits (key, attempts, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1
    `);
    increment.run(key, expiresAt);
    db.prepare("INSERT INTO login_request_times (requested_at) VALUES (?)").run(now);
    return { allowed: true, attempt: { key, expiresAt } };
  }).immediate();
}

/**
 * A successful login releases only its own account reservation. Earlier failures
 * and concurrent requests still count, and an old result cannot alter a new
 * window. Successful logins continue to consume the shared request budget.
 */
export function releaseSuccessfulLoginAttempt(attempt: LoginAttempt, db: Database.Database = getDb()): void {
  db.prepare(`
    UPDATE login_rate_limits SET attempts = MAX(0, attempts - 1)
    WHERE key = ? AND expires_at = ?
  `).run(attempt.key, attempt.expiresAt);
}
