import { getDb } from "./db";

export type User = {
  id: string;
  username: string;
  passwordHash: string;
  totpSecret: string | null;
  recoveryCodeHash: string | null;
  sessionVersion: number;
  createdAt: Date;
};

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  totp_secret: string | null;
  recovery_code_hash: string | null;
  session_version: number;
  created_at: number;
};

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    totpSecret: row.totp_secret,
    recoveryCodeHash: row.recovery_code_hash,
    sessionVersion: row.session_version,
    createdAt: new Date(row.created_at),
  };
}

export async function createUser(
  username: string,
  passwordHash: string
): Promise<User> {
  const db = getDb();
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  db.prepare(
    "INSERT INTO users (id, username, password_hash, totp_secret, created_at) VALUES (?, ?, ?, NULL, ?)"
  ).run(id, username, passwordHash, createdAt);
  return {
    id,
    username,
    passwordHash,
    totpSecret: null,
    recoveryCodeHash: null,
    sessionVersion: 0,
    createdAt: new Date(createdAt),
  };
}

export function getUserByUsername(username: string): User | null {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function getUserById(id: string): User | null {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(id) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function countUsers(): number {
  const result = getDb()
    .prepare("SELECT COUNT(*) as count FROM users")
    .get() as { count: number };
  return result.count;
}

export function setTotpSecret(userId: string, secret: string): void {
  getDb()
    .prepare("UPDATE users SET totp_secret = ?, session_version = session_version + 1 WHERE id = ?")
    .run(secret, userId);
}

export function clearTotpSecret(userId: string): void {
  getDb()
    .prepare("UPDATE users SET totp_secret = NULL, session_version = session_version + 1 WHERE id = ?")
    .run(userId);
}

/**
 * Change 2FA state and remove every other device in one SQLite transaction.
 * The current session remains usable after its user generation changes.
 */
export function updateTotpSecretAndRevokeOtherSessions(
  userId: string,
  currentSessionId: string,
  secret: string | null
): boolean {
  const db = getDb();
  return db.transaction(() => {
    const active = db.prepare("SELECT 1 FROM sessions WHERE id = ? AND user_id = ?")
      .get(currentSessionId, userId);
    if (!active) return false;
    const result = db.prepare(
      "UPDATE users SET totp_secret = ?, session_version = session_version + 1 WHERE id = ?"
    ).run(secret, userId);
    if (result.changes !== 1) return false;
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?")
      .run(userId, currentSessionId);
    return true;
  })();
}

export function setRecoveryCodeHash(userId: string, hash: string): void {
  getDb()
    .prepare("UPDATE users SET recovery_code_hash = ? WHERE id = ?")
    .run(hash, userId);
}

export function clearRecoveryCodeHash(userId: string): void {
  getDb()
    .prepare("UPDATE users SET recovery_code_hash = NULL WHERE id = ?")
    .run(userId);
}

export function updatePasswordHash(userId: string, passwordHash: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?")
      .run(passwordHash, userId);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  })();
}

/** Atomically consume a recovery code while replacing credentials. */
export function updatePasswordWithRecoveryCode(
  userId: string,
  expectedRecoveryCodeHash: string,
  passwordHash: string
): boolean {
  const db = getDb();
  return db.transaction(() => {
    const result = db.prepare(
      "UPDATE users SET password_hash = ?, recovery_code_hash = NULL, session_version = session_version + 1 WHERE id = ? AND recovery_code_hash = ?"
    ).run(passwordHash, userId, expectedRecoveryCodeHash);
    if (result.changes !== 1) return false;
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    return true;
  })();
}
