import { createHash } from "crypto";
import { getAuthSession, type AuthSession } from "./sessionStore";
import type { User } from "./users";
import { verifyPassword } from "./passwords";

type Auth = { user: User; session: AuthSession };
type Failure = { error: string; status: 400 | 401 | 429 };

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; expiresAt: number }>();

function attemptKey(token: string, sessionId?: string): string {
  return sessionId ?? createHash("sha256").update(token).digest("hex");
}

function pruneAttempts(now = Date.now()): void {
  for (const [key, entry] of attempts) {
    if (entry.expiresAt <= now) attempts.delete(key);
  }
}

/**
 * Confirm the current password against an active session. Re-reading the
 * session after bcrypt prevents a session revoked during that await from
 * authorizing a sensitive mutation.
 */
export async function verifySessionPassword(
  token: string | undefined,
  password: unknown
): Promise<{ auth: Auth } | Failure> {
  if (typeof password !== "string" || !password) {
    return { error: "password is required", status: 400 };
  }
  if (!token) return { error: "Unauthorized", status: 401 };

  pruneAttempts();
  const initial = await getAuthSession(token);
  if (!initial) return { error: "Unauthorized", status: 401 };
  const key = attemptKey(token, initial.session.id);
  const prior = attempts.get(key);
  if (prior && prior.count >= MAX_ATTEMPTS) {
    return { error: "Too many attempts. Try again later.", status: 429 };
  }
  // Reserve an attempt before bcrypt yields. Concurrent requests cannot all
  // observe the same count and bypass this per-session bound.
  attempts.set(key, {
    count: (prior?.count ?? 0) + 1,
    expiresAt: prior?.expiresAt ?? Date.now() + WINDOW_MS,
  });

  const initialPasswordHash = initial.user.passwordHash;
  const initialSessionVersion = initial.user.sessionVersion;
  const passwordOk = await verifyPassword(password, initialPasswordHash);
  const current = await getAuthSession(token);
  if (
    !current ||
    current.session.id !== initial.session.id ||
    current.user.id !== initial.user.id ||
    current.user.passwordHash !== initialPasswordHash ||
    current.user.sessionVersion !== initialSessionVersion
  ) {
    return { error: "Unauthorized", status: 401 };
  }
  if (!passwordOk) {
    return { error: "Invalid password", status: 401 };
  }
  attempts.delete(key);
  return { auth: current };
}
