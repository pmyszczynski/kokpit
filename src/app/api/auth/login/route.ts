import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getUserByUsername,
  verifyPassword,
  signJWT,
  signTotpChallenge,
  SESSION_COOKIE_NAME,
} from "@/auth";
import { getConfig } from "@/config";

// Use a pre-computed dummy hash so bcrypt always runs its full work factor,
// preventing username enumeration via response-time timing attacks.
const DUMMY_HASH = "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012";

export async function POST(req: Request) {
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

  if (user.totpSecret) {
    const challengeToken = await signTotpChallenge(user.id);
    return NextResponse.json({ requiresTotp: true, challengeToken });
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
