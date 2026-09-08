import { cookies } from "next/headers";
import type { KokpitConfig } from "@/config/schema";
import { getConfigSnapshot } from "@/config/server";
import { getAuthUser, SESSION_COOKIE_NAME } from "./session";

/**
 * True when the caller may access protected API routes: either auth is
 * disabled (via config or the KOKPIT_AUTH_DISABLED env var) or the request
 * carries a valid session cookie.
 */
export async function isRequestAuthenticated(config?: KokpitConfig): Promise<boolean> {
  // This explicit operational override intentionally remains available even
  // while settings.yaml is being repaired.
  if (process.env.KOKPIT_AUTH_DISABLED === "true") return true;
  const snapshot = config ? undefined : getConfigSnapshot();
  if (!config && snapshot?.state === "dirty") return false;
  const activeConfig = config ?? snapshot?.config;
  if (!activeConfig) return false;
  const authEnabled = activeConfig.auth.enabled;
  if (!authEnabled) return true;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const user = await getAuthUser(token);
  return user !== null;
}
