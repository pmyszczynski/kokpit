import type Database from "better-sqlite3";
import { getDb } from "./db";
import { SessionInvalidatedError, TotpChallengeCapacityError } from "./errors";
import { reserveTotpAttempt, releaseSuccessfulLoginAttempt } from "./loginRateLimit";
import { createSessionInDatabase, type AuthSession } from "./sessionStore";
import { verifyTotpCode } from "./totp";

export const TOTP_CHALLENGE_TTL_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 5;
const MAX_ACTIVE_PER_USER = 16;
const MAX_LIVE_CHALLENGES = 1024;
const JTI_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type TotpChallengeClaims = {
  jti: string;
  userId: string;
  sessionVersion: number;
  issuedAt: number;
  expiresAt: number;
};

type ChallengeRow = {
  jti: string; user_id: string; session_version: number; issued_at: number; expires_at: number;
  attempts: number; state: "active" | "consumed" | "exhausted";
  username: string; totp_secret: string | null; current_version: number;
};

export function isTotpChallengeClaims(value: unknown): value is TotpChallengeClaims {
  if (!value || typeof value !== "object") return false;
  const claim = value as Partial<TotpChallengeClaims>;
  return typeof claim.jti === "string" && JTI_PATTERN.test(claim.jti)
    && typeof claim.userId === "string" && claim.userId.length > 0 && claim.userId.length <= 128
    && Number.isSafeInteger(claim.sessionVersion) && claim.sessionVersion! >= 0
    && Number.isSafeInteger(claim.issuedAt) && claim.issuedAt! >= 0
    && Number.isSafeInteger(claim.expiresAt) && claim.expiresAt === claim.issuedAt! + TOTP_CHALLENGE_TTL_SECONDS;
}

function matches(row: ChallengeRow | undefined, claim: TotpChallengeClaims, now: number): row is ChallengeRow {
  return !!row && row.state === "active" && row.attempts < MAX_ATTEMPTS
    && row.user_id === claim.userId && row.session_version === claim.sessionVersion
    && row.current_version === claim.sessionVersion && row.issued_at === claim.issuedAt
    && row.expires_at === claim.expiresAt && claim.issuedAt <= now && claim.expiresAt > now;
}

function read(db: Database.Database, jti: string): ChallengeRow | undefined {
  return db.prepare(`
    SELECT c.*, u.username, u.totp_secret, u.session_version AS current_version
    FROM totp_challenges c JOIN users u ON u.id = c.user_id WHERE c.jti = ?
  `).get(jti) as ChallengeRow | undefined;
}

/** Register only server-issued challenges; submitted tokens never create rows. */
export function registerTotpChallenge(claim: TotpChallengeClaims, db: Database.Database = getDb()): void {
  db.transaction(() => {
    const now = Math.floor(Date.now() / 1000);
    if (!isTotpChallengeClaims(claim) || claim.issuedAt > now || claim.expiresAt <= now) throw new SessionInvalidatedError();
    db.prepare(`
      DELETE FROM totp_challenges WHERE expires_at <= ? OR NOT EXISTS (
        SELECT 1 FROM users WHERE id = totp_challenges.user_id AND session_version = totp_challenges.session_version
      )
    `).run(now);
    const current = db.prepare("SELECT 1 FROM users WHERE id = ? AND session_version = ?").get(claim.userId, claim.sessionVersion);
    if (!current) throw new SessionInvalidatedError();
    const user = db.prepare("SELECT COUNT(*) AS count, MIN(expires_at) AS expiry FROM totp_challenges WHERE user_id = ? AND state = 'active'")
      .get(claim.userId) as { count: number; expiry: number | null };
    const total = db.prepare("SELECT COUNT(*) AS count, MIN(expires_at) AS expiry FROM totp_challenges")
      .get() as { count: number; expiry: number | null };
    const blockedUntil = Math.max(user.count >= MAX_ACTIVE_PER_USER ? user.expiry! : 0, total.count >= MAX_LIVE_CHALLENGES ? total.expiry! : 0);
    if (blockedUntil > now) throw new TotpChallengeCapacityError(blockedUntil - now);
    const inserted = db.prepare(`
      INSERT INTO totp_challenges (jti, user_id, session_version, issued_at, expires_at)
      SELECT ?, id, session_version, ?, ? FROM users WHERE id = ? AND session_version = ?
    `).run(claim.jti, claim.issuedAt, claim.expiresAt, claim.userId, claim.sessionVersion);
    if (inserted.changes !== 1) throw new SessionInvalidatedError();
  }).immediate();
}

export function isRegisteredTotpChallenge(claim: TotpChallengeClaims, db: Database.Database = getDb()): boolean {
  return isTotpChallengeClaims(claim) && matches(read(db, claim.jti), claim, Math.floor(Date.now() / 1000));
}

type Completion =
  | { status: "invalid" }
  | { status: "wrong" }
  | { status: "exhausted" }
  | { status: "limited"; retryAfterSeconds: number }
  | { status: "success"; user: { id: string; username: string }; token: string; session: AuthSession };

/** No await: claim, code check, existing admission budgets and session are atomic. */
export function completeTotpChallenge(
  claim: TotpChallengeClaims,
  code: string,
  options: { userAgent?: string; idleTimeoutHours?: number } = {},
  db: Database.Database = getDb()
): Completion {
  if (!isTotpChallengeClaims(claim)) return { status: "invalid" };
  return db.transaction((): Completion => {
    const row = read(db, claim.jti);
    if (!matches(row, claim, Math.floor(Date.now() / 1000)) || !row.totp_secret) return { status: "invalid" };
    const admission = reserveTotpAttempt(claim.userId, db);
    if (!admission.allowed) return { status: "limited", retryAfterSeconds: admission.retryAfterSeconds };
    // otplib throws on malformed input. Count that input as a failed guess;
    // genuine verifier/storage failures still roll the transaction back.
    const sixAsciiDigits = code.length === 6 && !/[^0-9]/.test(code);
    if (!sixAsciiDigits || !verifyTotpCode(code, row.totp_secret)) {
      db.prepare(`UPDATE totp_challenges SET attempts = attempts + 1,
        state = CASE WHEN attempts + 1 >= ? THEN 'exhausted' ELSE 'active' END
        WHERE jti = ? AND state = 'active' AND attempts < ?
      `).run(MAX_ATTEMPTS, claim.jti, MAX_ATTEMPTS);
      return { status: row.attempts + 1 >= MAX_ATTEMPTS ? "exhausted" : "wrong" };
    }
    const claimed = db.prepare("UPDATE totp_challenges SET state = 'consumed' WHERE jti = ? AND state = 'active' AND attempts < ?")
      .run(claim.jti, MAX_ATTEMPTS);
    if (claimed.changes !== 1) return { status: "invalid" };
    const created = createSessionInDatabase(db, claim.userId, { ...options, expectedSessionVersion: claim.sessionVersion });
    releaseSuccessfulLoginAttempt(admission.attempt, db);
    return { status: "success", user: { id: claim.userId, username: row.username }, ...created };
  }).immediate();
}
