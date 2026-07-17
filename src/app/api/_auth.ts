import { cookies } from "next/headers";
import { getAuthUser, SESSION_COOKIE_NAME } from "@/auth";
import { getConfig } from "@/config";

/** True when the request carries a valid session, or when auth is disabled. */
export async function checkAuth(): Promise<boolean> {
  const config = getConfig();
  const authEnabled =
    config.auth.enabled && process.env.KOKPIT_AUTH_DISABLED !== "true";
  if (!authEnabled) return true;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const user = await getAuthUser(token);
  return !!user;
}
