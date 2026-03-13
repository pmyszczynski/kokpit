import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getAuthUser,
  SESSION_COOKIE_NAME,
  generateTotpSecret,
  getTotpUri,
  getTotpQrCode,
  verifyTotpCode,
  setTotpSecret,
  clearTotpSecret,
} from "@/auth";

async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return getAuthUser(token);
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.totpSecret !== null) {
    return NextResponse.json({ enabled: true });
  }

  const secret = generateTotpSecret();
  const uri = getTotpUri(secret, user.username);
  const qrCode = await getTotpQrCode(uri);

  return NextResponse.json({ enabled: false, secret, qrCode });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { secret?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { secret, code } = body;
  if (typeof secret !== "string" || typeof code !== "string" || !secret || !code) {
    return NextResponse.json(
      { error: "secret and code are required" },
      { status: 400 }
    );
  }

  if (!verifyTotpCode(code, secret)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  setTotpSecret(user.id, secret);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  if (!user.totpSecret || !verifyTotpCode(code, user.totpSecret)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  clearTotpSecret(user.id);
  return NextResponse.json({ ok: true });
}
