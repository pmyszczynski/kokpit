import { SignJWT, jwtVerify } from "jose";
import { getServerSecret } from "./serverSecret";
import { getUserById } from "./users";

export async function signTotpChallenge(userId: string, expectedSessionVersion: number): Promise<string> {
  const user = getUserById(userId);
  if (!user || user.sessionVersion !== expectedSessionVersion) {
    throw new Error("Challenge creation was invalidated");
  }
  return new SignJWT({ userId, sessionVersion: expectedSessionVersion, type: "totp_challenge" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("5m")
    .setIssuedAt()
    .sign(getServerSecret());
}

export async function verifyTotpChallenge(token: string): Promise<{ userId: string; sessionVersion: number } | null> {
  try {
    const { payload } = await jwtVerify(token, getServerSecret());
    if (typeof payload.userId !== "string" || !Number.isInteger(payload.sessionVersion)) return null;
    if (payload.type !== "totp_challenge") return null;
    const user = getUserById(payload.userId);
    if (!user || user.sessionVersion !== payload.sessionVersion) return null;
    return { userId: payload.userId, sessionVersion: payload.sessionVersion };
  } catch {
    return null;
  }
}
