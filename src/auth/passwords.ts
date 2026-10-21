import bcrypt from "bcryptjs";
import { MAX_NEW_PASSWORD_BYTES, NEW_PASSWORD_BYTE_LIMIT_MESSAGE } from "./passwordPolicy";

const SALT_ROUNDS = 10;

// Precomputed at SALT_ROUNDS for the public dummy password
// "kokpit-dummy-password-not-an-account". This is not an account credential.
// Keep its cost in sync with hashPassword so unknown users do real bcrypt work.
export const DUMMY_PASSWORD_HASH =
  "$2b$10$pvWhko9WqTymsjuk34xJHutQniKP5.ammkUFLIiZjkLGwpADFuFI2";

/** Identifiable validation failure without including the submitted password. */
export class NewPasswordTooLongError extends Error {
  readonly code = "password_too_long";

  constructor() {
    super(NEW_PASSWORD_BYTE_LIMIT_MESSAGE);
    this.name = "NewPasswordTooLongError";
  }
}

/** Keep legacy comparison unrestricted; apply this only when setting a hash. */
export function passwordExceedsBcryptLimit(plain: string): boolean {
  return Buffer.byteLength(plain, "utf8") > MAX_NEW_PASSWORD_BYTES;
}

/** Hash a newly chosen password only when bcrypt can consume all of its bytes. */
export async function hashPassword(plain: string): Promise<string> {
  if (passwordExceedsBcryptLimit(plain)) throw new NewPasswordTooLongError();
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
