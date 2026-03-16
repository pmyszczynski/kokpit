// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateSync } from "otplib";

describe("TOTP helpers", () => {
  it("generateTotpSecret returns a non-empty base32 string", async () => {
    const { generateTotpSecret } = await import("@/auth/totp");
    const secret = generateTotpSecret();
    expect(typeof secret).toBe("string");
    expect(secret.length).toBeGreaterThan(0);
    // base32 characters only
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  });

  it("getTotpUri returns an otpauth:// URI", async () => {
    const { getTotpUri, generateTotpSecret } = await import("@/auth/totp");
    const secret = generateTotpSecret();
    const uri = getTotpUri(secret, "alice");
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("Kokpit");
    expect(uri).toContain("alice");
  });

  it("getTotpQrCode returns a data URL", async () => {
    const { getTotpUri, getTotpQrCode, generateTotpSecret } = await import("@/auth/totp");
    const secret = generateTotpSecret();
    const uri = getTotpUri(secret, "alice");
    const qrCode = await getTotpQrCode(uri);
    expect(qrCode).toMatch(/^data:image\/png;base64,/);
  });

  it("verifyTotpCode accepts a valid code", async () => {
    const { generateTotpSecret, verifyTotpCode } = await import("@/auth/totp");
    const secret = generateTotpSecret();
    const validCode = generateSync({ secret });
    expect(verifyTotpCode(validCode, secret)).toBe(true);
  });

  it("verifyTotpCode rejects an invalid code", async () => {
    const { generateTotpSecret, verifyTotpCode } = await import("@/auth/totp");
    const secret = generateTotpSecret();
    expect(verifyTotpCode("000000", secret)).toBe(false);
  });
});
