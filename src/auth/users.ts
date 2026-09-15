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
    "INSERT INTO users (id, username, password_hash, totp_secret, session_version, created_at) VALUES (?, ?, ?, NULL, 0, ?)"
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
    .prepare("UPDATE users SET totp_secret = ? WHERE id = ?")
    .run(secret, userId);
}

export function clearTotpSecret(userId: string): void {
  getDb()
    .prepare("UPDATE users SET totp_secret = NULL WHERE id = ?")
    .run(userId);
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
  getDb()
    .prepare("UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?")
    .run(passwordHash, userId);
}

/**
 * Consumes one exact recovery-code hash while changing a password. Keeping the
 * comparison and credential-generation bump in one statement closes the
 * read-then-write race between concurrent recovery requests.
 */
export function consumeRecoveryCodeAndUpdatePassword(
  userId: string,
  recoveryCodeHash: string,
  passwordHash: string
): boolean {
  const result = getDb()
    .prepare(
      "UPDATE users SET password_hash = ?, recovery_code_hash = NULL, session_version = session_version + 1 WHERE id = ? AND recovery_code_hash = ?"
    )
    .run(passwordHash, userId, recoveryCodeHash);
  return result.changes === 1;
}
