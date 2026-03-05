import { verifyJWT } from "./jwt";
import { getUserById, type User } from "./users";

export const SESSION_COOKIE_NAME = "session";

export async function getAuthUser(
  token: string | undefined
): Promise<User | null> {
  if (!token) return null;
  const payload = await verifyJWT(token);
  if (!payload) return null;
  return getUserById(payload.userId);
}
