import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getUserByUsername,
  verifyPassword,
  signJWT,
  SESSION_COOKIE_NAME,
} from "@/auth";
import { getConfig } from "@/config";

export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { username, password } = body;
  if (!username || !password) {
    return NextResponse.json(
      { error: "username and password are required" },
      { status: 400 }
    );
  }

  const user = getUserByUsername(username);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const config = await getConfig();
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
