import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  verifyTotpChallenge,
  getUserById,
  verifyTotpCode,
  signJWT,
  SESSION_COOKIE_NAME,
} from "@/auth";
import { getConfig } from "@/config";

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

  const challenge = await verifyTotpChallenge(challengeToken);
  if (!challenge) {
    return NextResponse.json({ error: "Invalid or expired challenge" }, { status: 401 });
  }

  const user = getUserById(challenge.userId);
  if (!user || !user.totpSecret) {
    return NextResponse.json({ error: "Invalid or expired challenge" }, { status: 401 });
  }

  if (!verifyTotpCode(code, user.totpSecret)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 401 });
  }

  const config = getConfig();
  const ttl = config.auth.session_ttl_hours;
  const token = await signJWT(user.id, ttl);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ttl * 60 * 60,
  });

  return NextResponse.json({ id: user.id, username: user.username });
}
