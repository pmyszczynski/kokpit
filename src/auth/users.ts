import { getDb } from "./db";

export type User = {
  id: string;
  username: string;
  passwordHash: string;
  totpSecret: string | null;
  recoveryCodeHash: string | null;
  createdAt: Date;
};

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  totp_secret: string | null;
  recovery_code_hash: string | null;
  created_at: number;
};

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    totpSecret: row.totp_secret,
    recoveryCodeHash: row.recovery_code_hash,
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
    .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .run(passwordHash, userId);
}
