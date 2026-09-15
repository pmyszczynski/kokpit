import { SignJWT, jwtVerify } from "jose";
import { getServerSecret } from "./serverSecret";

export async function signJWT(
  userId: string,
  sessionVersion: number,
  ttlHours: number
): Promise<string> {
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  return new SignJWT({ userId, sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresAt)
    .setIssuedAt()
    .sign(getServerSecret());
}

export async function verifyJWT(
  token: string
): Promise<{ userId: string; sessionVersion: number } | null> {
  try {
    const { payload } = await jwtVerify(token, getServerSecret());
    if (typeof payload.userId !== "string") return null;
    if (payload.type === "totp_challenge") return null;
    const sessionVersion = readSessionVersion(payload.sessionVersion);
    if (sessionVersion === null) return null;
    return { userId: payload.userId, sessionVersion };
  } catch {
    return null;
  }
}

export async function signTotpChallenge(userId: string, sessionVersion: number): Promise<string> {
  return new SignJWT({ userId, sessionVersion, type: "totp_challenge" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("5m")
    .setIssuedAt()
    .sign(getServerSecret());
}

export async function verifyTotpChallenge(
  token: string
): Promise<{ userId: string; sessionVersion: number } | null> {
  try {
    const { payload } = await jwtVerify(token, getServerSecret());
    if (typeof payload.userId !== "string") return null;
    if (payload.type !== "totp_challenge") return null;
    const sessionVersion = readSessionVersion(payload.sessionVersion);
    if (sessionVersion === null) return null;
    return { userId: payload.userId, sessionVersion };
  } catch {
    return null;
  }
}

function readSessionVersion(value: unknown): number | null {
  // Tokens issued before credential generations existed remain valid only for
  // untouched legacy users, whose database value starts at zero.
  if (value === undefined) return 0;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
