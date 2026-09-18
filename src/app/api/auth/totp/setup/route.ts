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

  let body: { secret?: unknown; code?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { secret, code, password } = body;
  if (typeof secret !== "string" || typeof code !== "string" || !secret || !code) {
    return NextResponse.json(
      { error: "secret and code are required" },
      { status: 400 }
    );
  }

  const token = await getSessionToken();
  const verified = await verifySessionPassword(token, password);
  if (!("auth" in verified)) return NextResponse.json({ error: verified.error }, { status: verified.status });
  const { user, session } = verified.auth;
  if (user.totpSecret !== null) {
    return NextResponse.json({ error: "2FA is already enabled" }, { status: 409 });
  }
  if (!verifyTotpCode(code, secret)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  if (!updateTotpSecretAndRevokeOtherSessions(user.id, session.id, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!isTrustedMutation(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { code } = body;
  if (typeof code !== "string" || !code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }
  const token = await getSessionToken();
  // Revalidate after parsing the request so an intervening logout/revocation
  // cannot change 2FA state through a stale authenticated request.
  const auth = await getAuthSession(token);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { user, session } = auth;
  if (!user.totpSecret || !verifyTotpCode(code, user.totpSecret)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  if (!updateTotpSecretAndRevokeOtherSessions(user.id, session.id, null)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
