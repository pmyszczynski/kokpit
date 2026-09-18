import { NextResponse } from "next/server";
import {
  getUserByUsername,
  getUserById,
  verifyPassword,
  signTotpChallenge,
} from "@/auth";
import { createSessionCookie } from "../_session";
import { isTrustedMutation } from "@/auth/requestGuard";
import { SessionInvalidatedError } from "@/auth/errors";

// Use a pre-computed dummy hash so bcrypt always runs its full work factor,
// preventing username enumeration via response-time timing attacks.
const DUMMY_HASH = "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012";

export async function POST(req: Request) {
  if (!isTrustedMutation(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: { username?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { username, password } = body;
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

  const user = getUserByUsername(username);
  const candidateHash = user?.passwordHash ?? DUMMY_HASH;
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
  return NextResponse.json({ id: currentUser.id, username: currentUser.username });
}
