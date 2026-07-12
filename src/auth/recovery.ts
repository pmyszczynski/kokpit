import { randomBytes, createHash, timingSafeEqual } from "crypto";

const GROUP_COUNT = 4;
const GROUP_LENGTH = 8;

export function generateRecoveryCode(): string {
  const hex = randomBytes(GROUP_COUNT * GROUP_LENGTH * 0.5).toString("hex");
  const groups: string[] = [];
  for (let i = 0; i < GROUP_COUNT; i++) {
    groups.push(hex.slice(i * GROUP_LENGTH, (i + 1) * GROUP_LENGTH));
  }
  return groups.join("-");
}

function normalize(code: string): string {
  return code.trim().toLowerCase();
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalize(code)).digest("hex");
}

export function verifyRecoveryCode(code: string, hash: string): boolean {
  const candidate = Buffer.from(hashRecoveryCode(code), "hex");
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
