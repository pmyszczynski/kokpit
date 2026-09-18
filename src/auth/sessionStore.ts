import { createHash, randomBytes, randomUUID } from "crypto";
import { getDb } from "./db";
import { getUserById, type User } from "./users";

const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type AuthSession = {
  id: string;
  userId: string;
  device: string;
  createdAt: number;
  lastSeenAt: number;
  idleTimeoutHours: number;
};

type SessionRow = {
  id: string;
  user_id: string;
  device: string;
  created_at: number;
  last_seen_at: number;
  idle_timeout_hours: number;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function rowToSession(row: SessionRow): AuthSession {
  return {
    id: row.id,
    userId: row.user_id,
    device: row.device,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    idleTimeoutHours: row.idle_timeout_hours,
  };
}

function isExpired(session: AuthSession, now = Date.now()): boolean {
  return session.idleTimeoutHours > 0 &&
    now - session.lastSeenAt >= session.idleTimeoutHours * 60 * 60 * 1000;
}

function safeDeviceLabel(userAgent?: string): string {
  if (!userAgent) return "Unknown browser";
  const browser = /Edg\//.test(userAgent) ? "Edge"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : /Chrome\//.test(userAgent) || /CriOS\//.test(userAgent) ? "Chrome"
    : /Version\//.test(userAgent) && /Safari\//.test(userAgent) ? "Safari"
    : null;
  const platform = /Android/.test(userAgent) ? "Android"
    : /iPhone|iPad|iPod/.test(userAgent) ? "iOS"
    : /Windows/.test(userAgent) ? "Windows"
    : /Mac OS X/.test(userAgent) ? "macOS"
    : /Linux/.test(userAgent) ? "Linux"
    : null;
  return browser && platform ? `${browser} on ${platform}` : browser ?? "Unknown browser";
}

export function createSession(
  userId: string,
  options: { userAgent?: string; idleTimeoutHours?: number; expectedSessionVersion?: number } = {}
): { token: string; session: AuthSession } {
  const now = Date.now();
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const idleTimeoutHours = Number.isFinite(options.idleTimeoutHours) && (options.idleTimeoutHours ?? 0) > 0
    ? Math.floor(options.idleTimeoutHours!)
    : 0;
  const db = getDb();
  const expectedVersion = options.expectedSessionVersion ?? getUserById(userId)?.sessionVersion;
  if (expectedVersion === undefined) throw new Error("User does not exist");

  const result = db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, device, created_at, last_seen_at, idle_timeout_hours)
    SELECT ?, id, ?, ?, ?, ?, ?
    FROM users WHERE id = ? AND session_version = ?
  `).run(id, hashToken(token), safeDeviceLabel(options.userAgent), now, now, idleTimeoutHours, userId, expectedVersion);
  if (result.changes !== 1) throw new Error("Session creation was invalidated");

  return { token, session: { id, userId, device: safeDeviceLabel(options.userAgent), createdAt: now, lastSeenAt: now, idleTimeoutHours } };
}

export async function getAuthSession(token: string | undefined): Promise<{ user: User; session: AuthSession } | null> {
  if (!token || !OPAQUE_TOKEN_PATTERN.test(token)) return null;
  const db = getDb();
  const row = db.prepare(`
    SELECT id, user_id, device, created_at, last_seen_at, idle_timeout_hours
    FROM sessions WHERE token_hash = ?
  `).get(hashToken(token)) as SessionRow | undefined;
  if (!row) return null;
  const session = rowToSession(row);
  const now = Date.now();
  if (isExpired(session, now)) {
    db.prepare("DELETE FROM sessions WHERE id = ? AND token_hash = ?").run(session.id, hashToken(token));
    return null;
  }
  const user = getUserById(session.userId);
  if (!user) return null;
  if (session.idleTimeoutHours > 0 || now - session.lastSeenAt >= LAST_SEEN_WRITE_INTERVAL_MS) {
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now, session.id);
    session.lastSeenAt = now;
  }
  return { user, session };
}

export function revokeToken(token: string | undefined): void {
  if (!token || !OPAQUE_TOKEN_PATTERN.test(token)) return;
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function revokeSession(userId: string, sessionId: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").run(sessionId, userId);
}

export function revokeUserSessions(userId: string, exceptSessionId?: string): void {
  const db = getDb();
  if (exceptSessionId) {
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(userId, exceptSessionId);
    return;
  }
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function listSessions(userId: string): AuthSession[] {
  const now = Date.now();
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, user_id, device, created_at, last_seen_at, idle_timeout_hours
    FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC
  `).all(userId) as SessionRow[];
  const sessions = rows.map(rowToSession);
  const expired = sessions.filter((session) => isExpired(session, now));
  if (expired.length > 0) {
    const remove = db.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?");
    db.transaction(() => expired.forEach((session) => remove.run(session.id, userId)))();
  }
  return sessions.filter((session) => !isExpired(session, now));
}
