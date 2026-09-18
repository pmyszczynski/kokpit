import { cookies } from "next/headers";
import { createSession, SESSION_COOKIE_NAME } from "@/auth";
import { getConfig } from "@/config/server";

const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export async function setSessionCookie(
  token: string
): Promise<void> {
  const cookieStore = await cookies();
  writeSessionCookie(cookieStore, token);
}

function writeSessionCookie(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  token: string
): void {
  // Server-side idle expiry is authoritative. Keep the browser cookie long
  // lived so active users are not signed out on an arbitrary calendar date.
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.KOKPIT_INSECURE_COOKIE !== "true",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export async function createSessionCookie(
  userId: string,
  req?: Request,
  expectedSessionVersion?: number
): Promise<void> {
  const config = getConfig();
  const idleTimeoutHours = config.auth.session_idle_timeout_hours ?? 0;
  // Obtain the mutable cookie store before creating a DB session. If that
  // fails, no unusable server-side session has been issued.
  const cookieStore = await cookies();
  const { token } = createSession(userId, {
    userAgent: req?.headers.get("user-agent") ?? undefined,
    idleTimeoutHours,
    expectedSessionVersion,
  });
  writeSessionCookie(cookieStore, token);
}
