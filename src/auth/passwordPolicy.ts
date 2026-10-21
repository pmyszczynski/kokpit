/** Bcrypt's input boundary, measured without normalization or truncation. */
export const MAX_NEW_PASSWORD_BYTES = 72;
export const NEW_PASSWORD_BYTE_LIMIT_MESSAGE = "New passwords must be at most 72 UTF-8 bytes.";

/** Browser feedback; the server independently measures the bytes it hashes. */
export function newPasswordExceedsByteLimit(password: string): boolean {
  return new TextEncoder().encode(password).byteLength > MAX_NEW_PASSWORD_BYTES;
}
