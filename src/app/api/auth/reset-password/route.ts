import { NextResponse } from "next/server";
import { createHash } from "crypto";
import {
  getUserByUsername,
  verifyRecoveryCode,
  hashPassword,
  updatePasswordHash,
  clearRecoveryCodeHash,
} from "@/auth";

// Dummy hash so verifyRecoveryCode always does the same amount of work,
// preventing username enumeration via response-time timing attacks.
const DUMMY_HASH = createHash("sha256").update("dummy").digest("hex");

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface AttemptEntry { count: number; expiresAt: number }
const attempts = new Map<string, AttemptEntry>();

function pruneExpired() {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now > entry.expiresAt) attempts.delete(key);
  }
}

function isRateLimited(key: string): boolean {
  const entry = attempts.get(key);
  return !!entry && entry.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string) {
  const entry = attempts.get(key);
  if (entry) {
    entry.count += 1;
  } else {
    attempts.set(key, { count: 1, expiresAt: Date.now() + WINDOW_MS });
  }
}

export async function POST(req: Request) {
  pruneExpired();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { username, recoveryCode, newPassword } = body as {
    username?: unknown;
    recoveryCode?: unknown;
    newPassword?: unknown;
  };
  if (
    typeof username !== "string" ||
    typeof recoveryCode !== "string" ||
    typeof newPassword !== "string" ||
    !username ||
    !recoveryCode ||
    !newPassword
  ) {
    return NextResponse.json(
      { error: "username, recoveryCode and newPassword are required" },
      { status: 400 }
    );
  }
  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "newPassword must be at least 8 characters" },
      { status: 400 }
    );
  }

  const rateLimitKey = username.toLowerCase();
  if (isRateLimited(rateLimitKey)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 }
    );
  }

  const user = getUserByUsername(username);
  const candidateHash = user?.recoveryCodeHash ?? DUMMY_HASH;
  const codeOk = verifyRecoveryCode(recoveryCode, candidateHash);

  if (!user || !user.recoveryCodeHash || !codeOk) {
    recordFailure(rateLimitKey);
    return NextResponse.json(
      { error: "Invalid username or recovery code" },
      { status: 401 }
    );
  }

  const passwordHash = await hashPassword(newPassword);
  updatePasswordHash(user.id, passwordHash);
  // Single-use: the code is invalidated the moment it's redeemed.
  clearRecoveryCodeHash(user.id);
  attempts.delete(rateLimitKey);

  return NextResponse.json({
    ok: true,
    totpStillEnabled: user.totpSecret !== null,
  });
}
