import { NextResponse } from "next/server";
import {
  getUserByUsername,
  getUserById,
  verifyPassword,
  DUMMY_PASSWORD_HASH,
  signTotpChallenge,
} from "@/auth";
import { createSessionCookie } from "../_session";
import { isTrustedMutation } from "@/auth/requestGuard";
import { SessionInvalidatedError } from "@/auth/errors";
import { reserveLoginAttempt, releaseSuccessfulLoginAttempt } from "@/auth/loginRateLimit";

export async function POST(req: Request) {
  if (!isTrustedMutation(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { username, password } = body as { username?: unknown; password?: unknown };
  if (typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { error: "username and password must be strings" },
      { status: 400 }
    );
  }
  if (!username || !password) {
    return NextResponse.json(
      { error: "username and password are required" },
      { status: 400 }
    );
  }

  const reservation = reserveLoginAttempt(username);
  if (!reservation.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(reservation.retryAfterSeconds) } }
    );
  }

  const user = getUserByUsername(username);
  const candidateHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const passwordOk = await verifyPassword(password, candidateHash);
  if (!user || !passwordOk) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // bcrypt yielded above. Re-read before selecting the TOTP branch, otherwise
  // a password reset could replace credentials while an old-password login is
  // still in flight and receive a current-generation challenge.
  const currentUser = getUserById(user.id);
  if (
    !currentUser ||
    currentUser.passwordHash !== candidateHash ||
    currentUser.sessionVersion !== user.sessionVersion
  ) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  try {
    if (currentUser.totpSecret) {
      const challengeToken = await signTotpChallenge(currentUser.id, currentUser.sessionVersion);
      releaseSuccessfulLoginAttempt(reservation.attempt);
      return NextResponse.json({ requiresTotp: true, challengeToken });
    }
    await createSessionCookie(currentUser.id, req, currentUser.sessionVersion);
  } catch (error) {
    // The account changed while bcrypt was running (for example, its password
    // was reset), so do not issue a session for the stale credential check.
    if (error instanceof SessionInvalidatedError) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    throw error;
  }
  releaseSuccessfulLoginAttempt(reservation.attempt);
  return NextResponse.json({ id: currentUser.id, username: currentUser.username });
}
