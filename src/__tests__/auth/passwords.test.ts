// @vitest-environment node
import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "../../auth/passwords";

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
