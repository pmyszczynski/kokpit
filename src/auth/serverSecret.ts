import { randomBytes } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

let cachedSecret: Uint8Array | null = null;

const SHIPPED_PLACEHOLDER = "change-this-to-a-random-32-char-secret-before-use";

function rejectPlaceholder(secret: string, source: "environment" | "file"): void {
  if (secret === SHIPPED_PLACEHOLDER) {
    throw new Error(source === "environment"
      ? "KOKPIT_SESSION_SECRET uses the shipped placeholder. Remove the override to use a generated persisted key, or replace it with a random value (openssl rand -hex 32)."
      : "The persisted .session_secret uses the shipped placeholder. Stop Kokpit and deliberately replace that file with a random value (openssl rand -hex 32), then restart.");
  }
}

/**
 * Returns the stable key for TOTP challenges and purpose-separated server
 * primitives. Opaque SQLite-backed login sessions do not depend on this key.
 */
export function getServerSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;

  const envSecret = process.env.KOKPIT_SESSION_SECRET;
  if (envSecret !== undefined) {
    if (!envSecret.trim()) {
      throw new Error("KOKPIT_SESSION_SECRET must not be empty");
    }
    rejectPlaceholder(envSecret, "environment");
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
  rejectPlaceholder(secret, "file");

  cachedSecret = new TextEncoder().encode(secret);
  return cachedSecret;
}
