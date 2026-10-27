import { AUTH_JSON_BODY_BYTES, readJsonObject, RequestBodyError } from "@/lib/requestBody";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getAuthSession,
  SESSION_COOKIE_NAME,
  generateTotpSecret,
  getTotpUri,
  getTotpQrCode,
  verifyTotpCode,
  updateTotpSecretAndRevokeOtherSessions,
  verifySessionPassword,
} from "@/auth";
import { isTrustedMutation } from "@/auth/requestGuard";
import { reserveTotpAttempt, releaseSuccessfulLoginAttempt } from "@/auth/loginRateLimit";

async function getSessionToken() {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value;
}

export async function GET() {
  const token = await getSessionToken();
  const auth = await getAuthSession(token);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { user } = auth;

  if (user.totpSecret !== null) {
    return NextResponse.json({ enabled: true });
  }

  const secret = generateTotpSecret();
  const uri = getTotpUri(secret, user.username);
  const qrCode = await getTotpQrCode(uri);

  return NextResponse.json({ enabled: false, secret, qrCode });
}

export async function POST(req: Request) {
  if (!isTrustedMutation(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const token = await getSessionToken();
  if (!(await getAuthSession(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { secret?: unknown; code?: unknown; password?: unknown };
  try {
    body = await readJsonObject(req, AUTH_JSON_BODY_BYTES);
  } catch (error) {
    return NextResponse.json({ error: error instanceof RequestBodyError ? error.message : "Invalid JSON" },
      { status: error instanceof RequestBodyError ? error.status : 400 });
  }

  const { secret, code, password } = body;
  if (typeof secret !== "string" || typeof code !== "string" || !secret || !code) {
    return NextResponse.json(
      { error: "secret and code are required" },
      { status: 400 }
    );
  }

  const verified = await verifySessionPassword(token, password);
  if (!("auth" in verified)) return NextResponse.json({ error: verified.error }, { status: verified.status });
  const { user, session } = verified.auth;
  if (user.totpSecret !== null) {
    return NextResponse.json({ error: "2FA is already enabled" }, { status: 409 });
  }
  if (!verifyTotpCode(code, secret)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  const result = updateTotpSecretAndRevokeOtherSessions(
    user.id,
    session.id,
    user.sessionVersion,
    user.totpSecret,
    secret
  );
  if (result === "session-revoked") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (result === "conflict") {
    return NextResponse.json({ error: "2FA settings changed; reload and try again" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!isTrustedMutation(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const token = await getSessionToken();
  if (!(await getAuthSession(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { code?: unknown; password?: unknown };
  try {
    body = await readJsonObject(req, AUTH_JSON_BODY_BYTES);
  } catch (error) {
    return NextResponse.json({ error: error instanceof RequestBodyError ? error.message : "Invalid JSON" },
      { status: error instanceof RequestBodyError ? error.status : 400 });
  }

  const { code, password } = body;
  if (typeof code !== "string" || !code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }
  // Revalidate after parsing the request so an intervening logout/revocation
  // cannot change 2FA state through a stale authenticated request.
  const auth = await getAuthSession(token);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admission = reserveTotpAttempt(auth.user.id);
  if (!admission.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(admission.retryAfterSeconds) } });
  }
  const verified = await verifySessionPassword(token, password);
  if (!("auth" in verified)) return NextResponse.json({ error: verified.error }, { status: verified.status });
  const { user, session } = verified.auth;
  // Reject malformed codes before otplib, which can throw on invalid input.
  if (!user.totpSecret || code.length !== 6 || /[^0-9]/.test(code) || !verifyTotpCode(code, user.totpSecret)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  const result = updateTotpSecretAndRevokeOtherSessions(
    user.id,
    session.id,
    user.sessionVersion,
    user.totpSecret,
    null
  );
  if (result === "session-revoked") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (result === "conflict") {
    return NextResponse.json({ error: "2FA settings changed; reload and try again" }, { status: 409 });
  }
  releaseSuccessfulLoginAttempt(admission.attempt);
  return NextResponse.json({ ok: true });
}
