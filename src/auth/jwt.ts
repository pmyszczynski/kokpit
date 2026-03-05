import { SignJWT, jwtVerify } from "jose";

let cachedSecret: Uint8Array | null = null;

function getSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const secret = process.env.KOKPIT_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "KOKPIT_SESSION_SECRET env var is required. Set it in docker-compose.yml or .env.local."
    );
  }
  cachedSecret = new TextEncoder().encode(secret);
  return cachedSecret;
}

export async function signJWT(
  userId: string,
  ttlHours: number
): Promise<string> {
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresAt)
    .setIssuedAt()
    .sign(getSecret());
}

export async function verifyJWT(
  token: string
): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.userId !== "string") return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}
