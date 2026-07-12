// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateRecoveryCode, hashRecoveryCode, verifyRecoveryCode } from "../../auth/recovery";

describe("recovery code helpers", () => {
  it("generates a code in the xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx format", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{8}){3}$/);
  });

  it("generates unique codes", () => {
    const a = generateRecoveryCode();
    const b = generateRecoveryCode();
    expect(a).not.toBe(b);
  });

  it("verifies a code against its own hash", () => {
    const code = generateRecoveryCode();
    const hash = hashRecoveryCode(code);
    expect(verifyRecoveryCode(code, hash)).toBe(true);
  });

  it("rejects an incorrect code", () => {
    const hash = hashRecoveryCode(generateRecoveryCode());
    expect(verifyRecoveryCode(generateRecoveryCode(), hash)).toBe(false);
  });

  it("is case-insensitive", () => {
    const code = generateRecoveryCode();
    const hash = hashRecoveryCode(code);
    expect(verifyRecoveryCode(code.toUpperCase(), hash)).toBe(true);
  });

  it("tolerates surrounding whitespace", () => {
    const code = generateRecoveryCode();
    const hash = hashRecoveryCode(code);
    expect(verifyRecoveryCode(`  ${code}  `, hash)).toBe(true);
  });
});
