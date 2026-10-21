// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword, NewPasswordTooLongError } from "../../auth/passwords";
import { newPasswordExceedsByteLimit } from "@/auth/passwordPolicy";

describe("new-password byte policy", () => {
  it.each(["a".repeat(71), "a".repeat(72), "😀".repeat(18), "e\u0301".repeat(24)])(
    "accepts a complete password within the UTF-8 byte boundary", async password => {
      expect(newPasswordExceedsByteLimit(password)).toBe(false);
      const hash = await hashPassword(password);
      expect(await verifyPassword(password, hash)).toBe(true);
    }
  );

  it.each(["a".repeat(73), "😀".repeat(18) + "a", "😀".repeat(19), "e\u0301".repeat(24) + "é"])(
    "rejects byte overflow before bcrypt without truncation", async password => {
      const hash = vi.spyOn(bcrypt, "hash");
      try {
        expect(newPasswordExceedsByteLimit(password)).toBe(true);
        await expect(hashPassword(password)).rejects.toBeInstanceOf(NewPasswordTooLongError);
        expect(hash).not.toHaveBeenCalled();
      } finally { hash.mockRestore(); }
    }
  );

  it("does not normalize combining characters while hashing", async () => {
    const password = "e\u0301".repeat(24);
    const hash = await hashPassword(password);
    expect(await verifyPassword(password.normalize("NFC"), hash)).toBe(false);
  });

  it("preserves legacy comparison of overlong candidates without rehashing an accepted suffix", async () => {
    const prefix = "x".repeat(72);
    const legacyHash = await bcrypt.hash(prefix + "original suffix", 10);
    expect(await verifyPassword(prefix + "different suffix", legacyHash)).toBe(true);
    expect(await verifyPassword("different prefix", legacyHash)).toBe(false);
  });
});

describe("unknown-user dummy hash", () => {
  it("is a complete working bcrypt hash at the same cost as new passwords", async () => {
    const hash = await hashPassword("ordinary-account-password");
    expect(DUMMY_PASSWORD_HASH).toMatch(/^\$2b\$\d{2}\$[./A-Za-z0-9]{53}$/);
    expect(bcrypt.getRounds(DUMMY_PASSWORD_HASH)).toBe(bcrypt.getRounds(hash));
    // A malformed hash returns false immediately. A successful real comparison
    // establishes that this fixture takes bcrypt's complete verification path.
    expect(await verifyPassword("kokpit-dummy-password-not-an-account", DUMMY_PASSWORD_HASH)).toBe(true);
    expect(await verifyPassword("wrong-password", DUMMY_PASSWORD_HASH)).toBe(false);
  });
});

describe("hashPassword()", () => {
  it("returns a bcrypt hash string", async () => {
    const hash = await hashPassword("mypassword");
    expect(hash).toMatch(/^\$2b\$10\$/);
  });

  it("produces different hashes for the same password", async () => {
    const h1 = await hashPassword("same");
    const h2 = await hashPassword("same");
    expect(h1).not.toBe(h2);
  });
});

describe("verifyPassword()", () => {
  it("returns true when password matches hash", async () => {
    const hash = await hashPassword("correct");
    expect(await verifyPassword("correct", hash)).toBe(true);
  });

  it("returns false when password does not match hash", async () => {
    const hash = await hashPassword("correct");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});
