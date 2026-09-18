import { getAuthSession } from "./sessionStore";
import type { User } from "./users";

export const SESSION_COOKIE_NAME = "session";

export async function getAuthUser(
  token: string | undefined
): Promise<User | null> {
  if (!token) return null;
  return (await getAuthSession(token))?.user ?? null;
}

export { getAuthSession } from "./sessionStore";
