import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

// Precomputed at SALT_ROUNDS for the public dummy password
// "kokpit-dummy-password-not-an-account". This is not an account credential.
// Keep its cost in sync with hashPassword so unknown users do real bcrypt work.
export const DUMMY_PASSWORD_HASH =
  "$2b$10$pvWhko9WqTymsjuk34xJHutQniKP5.ammkUFLIiZjkLGwpADFuFI2";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
