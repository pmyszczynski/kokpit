import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

let cachedSecret: Uint8Array | null = null;

function getSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;

  const envSecret = process.env.KOKPIT_SESSION_SECRET;
  if (envSecret) {
    cachedSecret = new TextEncoder().encode(envSecret);
    return cachedSecret;
  }

  // No env var — auto-generate a secret and persist it next to the database so
  // it survives container restarts via the /data volume mount.
  const dbDir = dirname(process.env.KOKPIT_DB_PATH ?? "data/users.db");
  const secretPath = join(dbDir, ".session_secret");

  let secret: string;
  if (existsSync(secretPath)) {
    secret = readFileSync(secretPath, "utf-8").trim();
  } else {
    secret = randomBytes(32).toString("hex");
    mkdirSync(dbDir, { recursive: true });
    writeFileSync(secretPath, secret, { encoding: "utf-8", mode: 0o600 });
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
    .sign(getSecret());
}

export async function verifyTotpChallenge(
  token: string
): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.userId !== "string") return null;
    if (payload.type !== "totp_challenge") return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}
