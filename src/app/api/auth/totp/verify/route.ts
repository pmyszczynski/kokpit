import { NextResponse } from "next/server";
import {
  verifyTotpChallenge,
  getUserById,
  verifyTotpCode,
} from "@/auth";
import { createSessionCookie } from "../../_session";

const MAX_TOTP_ATTEMPTS = 5;
// In-memory attempt tracking keyed by challenge token.
// Each entry is invalidated after MAX_TOTP_ATTEMPTS failures or on success.
const failedAttempts = new Map<string, number>();
const invalidatedTokens = new Set<string>();

export async function POST(req: Request) {
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

  if (invalidatedTokens.has(challengeToken)) {
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
    const attempts = (failedAttempts.get(challengeToken) ?? 0) + 1;
    if (attempts >= MAX_TOTP_ATTEMPTS) {
      failedAttempts.delete(challengeToken);
      invalidatedTokens.add(challengeToken);
      return NextResponse.json({ error: "Too many failed attempts" }, { status: 429 });
    }
    failedAttempts.set(challengeToken, attempts);
    return NextResponse.json({ error: "Invalid code" }, { status: 401 });
  }

  // Success: clear attempt state and prevent token replay.
  failedAttempts.delete(challengeToken);
  invalidatedTokens.add(challengeToken);

  await createSessionCookie(user.id);
  return NextResponse.json({ id: user.id, username: user.username });
}
