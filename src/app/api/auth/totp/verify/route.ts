import { NextResponse } from "next/server";
import { createHash } from "crypto";
import {
  verifyTotpChallenge,
  getUserById,
  verifyTotpCode,
} from "@/auth";
import { createSessionCookie } from "../../_session";

const MAX_TOTP_ATTEMPTS = 5;
// TOTP challenge tokens expire in 5 minutes; prune local state at the same cadence.
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

interface AttemptEntry { count: number; expiresAt: number }
const failedAttempts = new Map<string, AttemptEntry>();
const invalidatedTokens = new Map<string, number>(); // key -> expiresAt

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function pruneExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of failedAttempts) {
    if (now > entry.expiresAt) failedAttempts.delete(key);
  }
  for (const [key, expiresAt] of invalidatedTokens) {
    if (now > expiresAt) invalidatedTokens.delete(key);
  }
}

export async function POST(req: Request) {
  pruneExpiredEntries();

  let body: { challengeToken?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { challengeToken, code } = body;
  if (typeof challengeToken !== "string" || typeof code !== "string" || !challengeToken || !code) {
    return NextResponse.json(
      { error: "challengeToken and code are required" },
      { status: 400 }
    );
  }

  const key = tokenKey(challengeToken);
  if (invalidatedTokens.has(key)) {
    return NextResponse.json({ error: "Challenge token has been invalidated" }, { status: 401 });
  }

  const challenge = await verifyTotpChallenge(challengeToken);
  if (!challenge) {
    return NextResponse.json({ error: "Invalid or expired challenge" }, { status: 401 });
  }

  const user = getUserById(challenge.userId);
  if (!user || !user.totpSecret) {
    return NextResponse.json({ error: "Invalid or expired challenge" }, { status: 401 });
  }

  if (!verifyTotpCode(code, user.totpSecret)) {
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;
    const entry = failedAttempts.get(key);
    const attempts = (entry?.count ?? 0) + 1;
    if (attempts >= MAX_TOTP_ATTEMPTS) {
      failedAttempts.delete(key);
      invalidatedTokens.set(key, expiresAt);
      return NextResponse.json({ error: "Too many failed attempts" }, { status: 429 });
    }
    failedAttempts.set(key, { count: attempts, expiresAt });
    return NextResponse.json({ error: "Invalid code" }, { status: 401 });
  }

  // Success: clear attempt state and prevent token replay.
  failedAttempts.delete(key);
  invalidatedTokens.set(key, Date.now() + CHALLENGE_TTL_MS);

  await createSessionCookie(user.id);
  return NextResponse.json({ id: user.id, username: user.username });
}
