import { randomBytes } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
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
  if (envSecret !== undefined) {
    if (!envSecret.trim()) {
      throw new Error("KOKPIT_SESSION_SECRET must not be empty");
    }
    cachedSecret = new TextEncoder().encode(envSecret);
    return cachedSecret;
  }

  const dbDir = dirname(process.env.KOKPIT_DB_PATH ?? "data/users.db");
  const secretPath = join(dbDir, ".session_secret");

  let secret: string;
  try {
    secret = readFileSync(secretPath, "utf-8").trim();
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
    mkdirSync(dbDir, { recursive: true });
    secret = randomBytes(32).toString("hex");
    try {
      writeFileSync(secretPath, secret, {
        encoding: "utf-8",
        mode: 0o600,
        flag: "wx",
      });
    } catch (writeError) {
      if (
        typeof writeError !== "object" ||
        writeError === null ||
        !("code" in writeError) ||
        writeError.code !== "EEXIST"
      ) {
        throw writeError;
      }
      secret = readFileSync(secretPath, "utf-8").trim();
    }
  }

  if (!secret.trim()) {
    throw new Error("Server session secret must not be empty");
  }

  cachedSecret = new TextEncoder().encode(secret);
  return cachedSecret;
}
