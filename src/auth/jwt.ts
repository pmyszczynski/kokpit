import { SignJWT, jwtVerify } from "jose";
import { getServerSecret } from "./serverSecret";

export async function signJWT(
  userId: string,
  ttlHours: number
): Promise<string> {
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresAt)
    .setIssuedAt()
    .sign(getServerSecret());
}

export async function verifyJWT(
  token: string
): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getServerSecret());
    if (typeof payload.userId !== "string") return null;
    if (payload.type === "totp_challenge") return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

export async function signTotpChallenge(userId: string): Promise<string> {
  return new SignJWT({ userId, type: "totp_challenge" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("5m")
    .setIssuedAt()
    .sign(getServerSecret());
}

export async function verifyTotpChallenge(
  token: string
): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getServerSecret());
    if (typeof payload.userId !== "string") return null;
    if (payload.type !== "totp_challenge") return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}
