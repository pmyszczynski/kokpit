import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

let cachedSecret: Uint8Array | null = null;

/**
 * Returns the stable server secret shared by session signing and other
 * purpose-separated server primitives. The persisted bytes intentionally
 * retain the existing JWT behavior so already-issued sessions remain valid.
 */
export function getServerSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;

  const envSecret = process.env.KOKPIT_SESSION_SECRET;
  if (envSecret) {
    cachedSecret = new TextEncoder().encode(envSecret);
    return cachedSecret;
  }

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
