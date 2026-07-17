import { cookies } from "next/headers";
import { getConfig } from "@/config";
import { getAuthUser, SESSION_COOKIE_NAME } from "./session";

/**
 * True when the caller may access protected API routes: either auth is
 * disabled (via config or the KOKPIT_AUTH_DISABLED env var) or the request
 * carries a valid session cookie.
 */
export async function isRequestAuthenticated(): Promise<boolean> {
  const config = getConfig();
  const authEnabled =
    config.auth.enabled && process.env.KOKPIT_AUTH_DISABLED !== "true";
  if (!authEnabled) return true;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const user = await getAuthUser(token);
  return user !== null;
}
