import { cookies } from "next/headers";
import { getConfig } from "@/config/server";
import { getAuthUser, SESSION_COOKIE_NAME } from "./session";

export function isAuthenticationEnabled(): boolean {
  const config = getConfig();
  return config.auth.enabled && process.env.KOKPIT_AUTH_DISABLED !== "true";
}

/**
 * True when the caller may access protected API routes: either auth is
 * disabled (via config or the KOKPIT_AUTH_DISABLED env var) or the request
 * carries a valid session cookie.
 */
export async function isRequestAuthenticated(): Promise<boolean> {
  if (!isAuthenticationEnabled()) return true;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const user = await getAuthUser(token);
  return user !== null;
}
