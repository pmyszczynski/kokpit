import { AUTH_JSON_BODY_BYTES, readJsonObject, RequestBodyError } from "@/lib/requestBody";
import { NextResponse } from "next/server";
import { verifyTotpChallenge, revokeSession } from "@/auth";
import { prepareSessionCookie } from "../../_session";
import { isTrustedMutation } from "@/auth/requestGuard";
import { completeTotpChallenge } from "@/auth/totpChallengeStore";
import { getConfig } from "@/config/server";

export async function POST(req: Request) {
  if (!isTrustedMutation(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: { challengeToken?: unknown; code?: unknown };
  try {
    body = await readJsonObject(req, AUTH_JSON_BODY_BYTES);
  } catch (error) {
    return NextResponse.json({ error: error instanceof RequestBodyError ? error.message : "Invalid JSON" },
      { status: error instanceof RequestBodyError ? error.status : 400 });
  }

  const { challengeToken, code } = body;
  if (typeof challengeToken !== "string" || typeof code !== "string" || !challengeToken || !code) {
    return NextResponse.json(
      { error: "challengeToken and code are required" },
      { status: 400 }
    );
  }

  try {
    const challenge = await verifyTotpChallenge(challengeToken);
    if (!challenge) return NextResponse.json({ error: "Invalid or expired challenge. Start login again." }, { status: 401 });
    const writeCookie = await prepareSessionCookie();
    const result = completeTotpChallenge(challenge, code, {
      userAgent: req.headers.get("user-agent") ?? undefined,
      idleTimeoutHours: getConfig().auth.session_idle_timeout_hours ?? 0,
    });
    if (result.status === "invalid") {
      return NextResponse.json({ error: "Invalid or expired challenge. Start login again." }, { status: 401 });
    }
    if (result.status === "limited") {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
      );
    }
    if (result.status === "wrong") return NextResponse.json({ error: "Invalid code" }, { status: 401 });
    if (result.status === "exhausted") {
      return NextResponse.json({ error: "Too many failed attempts. Start login again." }, { status: 429 });
    }
    try {
      // The transaction has committed. A broken cookie writer must not leave
      // an unusable session behind, but the challenge stays consumed.
      writeCookie(result.token);
    } catch (error) {
      revokeSession(result.user.id, result.session.id);
      throw error;
    }
    return NextResponse.json(result.user);
  } catch {
    // Includes a failed session insertion: its enclosing transaction rolled
    // back, so a temporary storage failure cannot consume the challenge.
    // Log an operational signal without exception text, tokens or OTP values.
    console.error("[auth] TOTP verification could not be completed");
    return NextResponse.json({ error: "Login could not be completed. Try again or restart login." }, { status: 503 });
  }
}
