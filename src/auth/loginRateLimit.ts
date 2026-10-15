import { createHash } from "node:crypto";
import { getDb } from "./db";

const ACCOUNT_LIMIT = 10;
const ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_LIMIT = 100;
const GLOBAL_WINDOW_MS = 60 * 1000;

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
  const db = getDb();
  const key = `account:${createHash("sha256").update(username.toLowerCase()).digest("hex")}`;
  return db.transaction((): Decision => {
    const now = Date.now();
    db.prepare("DELETE FROM login_rate_limits WHERE expires_at <= ?").run(now);
    const read = db.prepare("SELECT attempts, expires_at FROM login_rate_limits WHERE key = ?");
    const account = read.get(key) as Counter | undefined;
    const global = read.get("global") as Counter | undefined;
    const blockedUntil = Math.max(
      account && account.attempts >= ACCOUNT_LIMIT ? account.expires_at : 0,
      global && global.attempts >= GLOBAL_LIMIT ? global.expires_at : 0
    );
    if (blockedUntil > now) {
      return { allowed: false, retryAfterSeconds: Math.ceil((blockedUntil - now) / 1000) };
    }
    const expiresAt = account?.expires_at ?? now + ACCOUNT_WINDOW_MS;
    const increment = db.prepare(`
      INSERT INTO login_rate_limits (key, attempts, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1
    `);
    increment.run(key, expiresAt);
    increment.run("global", global?.expires_at ?? now + GLOBAL_WINDOW_MS);
    return { allowed: true, attempt: { key, expiresAt } };
  }).immediate();
}

/**
 * A successful login releases only its own account reservation. Earlier failures
 * and concurrent requests still count, and an old result cannot alter a new
 * window. Successful logins continue to consume the shared request budget.
 */
export function releaseSuccessfulLoginAttempt(attempt: LoginAttempt): void {
  getDb().prepare(`
    UPDATE login_rate_limits SET attempts = MAX(0, attempts - 1)
    WHERE key = ? AND expires_at = ?
  `).run(attempt.key, attempt.expiresAt);
}
