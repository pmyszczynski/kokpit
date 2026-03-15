import { cookies } from "next/headers";
import { signJWT, SESSION_COOKIE_NAME } from "@/auth";
import { getConfig } from "@/config";

export async function createSessionCookie(userId: string): Promise<void> {
  const config = getConfig();
  const ttl = config.auth.session_ttl_hours;
  const token = await signJWT(userId, ttl);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ttl * 60 * 60,
  });
}
