// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { decodeJwt, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";

beforeAll(() => {
  process.env.KOKPIT_SESSION_SECRET =
    "test-secret-32-chars-minimum-length-xx";
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  const { closeDb } = await import("../../auth/db");
  closeDb();
});

describe("TOTP challenges", () => {
  beforeEach(async () => {
    const { closeDb } = await import("../../auth/db");
    closeDb();
    vi.resetModules();
    process.env.KOKPIT_DB_PATH = ":memory:";
  });

  it("binds a challenge to the user session generation", async () => {
    const { createUser, setTotpSecret } = await import("../../auth/users");
    const { signTotpChallenge, verifyTotpChallenge } = await import("../../auth/jwt");
    const user = await createUser("challenge", "hash");
    const token = await signTotpChallenge(user.id, user.sessionVersion);
    expect(await verifyTotpChallenge(token)).toMatchObject({ userId: user.id, sessionVersion: 0 });
    setTotpSecret(user.id, "new-secret");
    expect(await verifyTotpChallenge(token)).toBeNull();
  });

  it("refuses to stamp stale credential proof with a generation created by password reset", async () => {
    const { createUser, updatePasswordHash } = await import("../../auth/users");
    const { signTotpChallenge } = await import("../../auth/jwt");
    const user = await createUser("stale-proof", "old-hash");
    updatePasswordHash(user.id, "new-hash");
    await expect(signTotpChallenge(user.id, user.sessionVersion)).rejects.toMatchObject({
      name: "SessionInvalidatedError",
    });
  });

  it("rejects a legacy challenge without a session generation", async () => {
    const { createUser } = await import("../../auth/users");
    const { verifyTotpChallenge } = await import("../../auth/jwt");
    const user = await createUser("legacy", "hash");
    const token = await new SignJWT({ userId: user.id, type: "totp_challenge" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(process.env.KOKPIT_SESSION_SECRET!));
    expect(await verifyTotpChallenge(token)).toBeNull();
  });

  it("issues distinct registered challenges in the same second with matching fixed expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    const { createUser } = await import("../../auth/users");
    const { getDb } = await import("../../auth/db");
    const { signTotpChallenge, verifyTotpChallenge } = await import("../../auth/jwt");
    const user = await createUser("same-second", "hash");
    const first = await signTotpChallenge(user.id, user.sessionVersion);
    const second = await signTotpChallenge(user.id, user.sessionVersion);
    const a = decodeJwt(first); const b = decodeJwt(second);
    expect(first).not.toBe(second); expect(a.jti).not.toBe(b.jti);
    expect(a.iat).toBe(b.iat); expect(a.exp).toBe(a.iat! + 300);
    expect(a.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
    expect(getDb().prepare("SELECT issued_at, expires_at FROM totp_challenges WHERE jti = ?").get(a.jti)).toEqual({ issued_at: a.iat, expires_at: a.exp });
    expect(await verifyTotpChallenge(first)).toMatchObject({ jti: a.jti, userId: user.id });
    expect(await verifyTotpChallenge(second)).toMatchObject({ jti: b.jti, userId: user.id });
  });

  it.each([
    ["missing jti", { jti: undefined }],
    ["malformed jti", { jti: "not-a-challenge-id" }],
    ["unregistered jti", { jti: "11111111-1111-4111-8111-111111111111" }],
    ["wrong type", { type: "session" }],
    ["missing generation", { sessionVersion: undefined }],
    ["fractional generation", { sessionVersion: 0.5 }],
    ["negative generation", { sessionVersion: -1 }],
    ["wrong user", { userId: "other-user" }],
    ["missing issue time", { iat: undefined }],
    ["fractional issue time", { iat: 1.5 }],
    ["missing expiry", { exp: undefined }],
    ["fractional expiry", { exp: 9_999_999_999.5 }],
    ["mismatched expiry", { exp: 9_999_999_999 }],
  ])("rejects a signed challenge with %s", async (_name, overrides) => {
    const { createUser } = await import("../../auth/users");
    const { signTotpChallenge, verifyTotpChallenge } = await import("../../auth/jwt");
    const user = await createUser("invalid-claims", "hash");
    const claims = decodeJwt(await signTotpChallenge(user.id, user.sessionVersion));
    const token = await new SignJWT({ ...claims, ...overrides })
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode(process.env.KOKPIT_SESSION_SECRET!));
    expect(await verifyTotpChallenge(token)).toBeNull();
  });

  it("rejects other HMAC algorithms even with valid registered claims", async () => {
    const { createUser } = await import("../../auth/users");
    const { signTotpChallenge, verifyTotpChallenge } = await import("../../auth/jwt");
    const user = await createUser("algorithm", "hash");
    const claims = decodeJwt(await signTotpChallenge(user.id, user.sessionVersion));
    const token = await new SignJWT(claims).setProtectedHeader({ alg: "HS384" })
      .sign(new TextEncoder().encode(process.env.KOKPIT_SESSION_SECRET!));
    expect(await verifyTotpChallenge(token)).toBeNull();
  });

  it("requires the registered row rather than creating it from a signed token", async () => {
    const { createUser } = await import("../../auth/users");
    const { getDb } = await import("../../auth/db");
    const { signTotpChallenge, verifyTotpChallenge } = await import("../../auth/jwt");
    const user = await createUser("missing-row", "hash");
    const token = await signTotpChallenge(user.id, user.sessionVersion);
    getDb().prepare("DELETE FROM totp_challenges WHERE jti = ?").run(decodeJwt(token).jti);
    expect(await verifyTotpChallenge(token)).toBeNull();
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM totp_challenges").get()).toEqual({ count: 0 });
  });

  it("rejects the challenge exactly at its fixed expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    const { createUser } = await import("../../auth/users");
    const { signTotpChallenge, verifyTotpChallenge } = await import("../../auth/jwt");
    const user = await createUser("expiry", "hash");
    const token = await signTotpChallenge(user.id, user.sessionVersion);
    vi.advanceTimersByTime(299_000);
    expect(await verifyTotpChallenge(token)).not.toBeNull();
    vi.advanceTimersByTime(1000);
    expect(await verifyTotpChallenge(token)).toBeNull();
  });

  it("does not register stale proof when credentials change while signing", async () => {
    const { createUser, updatePasswordHash } = await import("../../auth/users");
    const { getDb } = await import("../../auth/db");
    const { signTotpChallenge } = await import("../../auth/jwt");
    const user = await createUser("signing-race", "old-hash");
    const original = SignJWT.prototype.sign;
    vi.spyOn(SignJWT.prototype, "sign").mockImplementation(async function (this: SignJWT, ...args: Parameters<typeof original>) {
      const token = await original.apply(this, args);
      updatePasswordHash(user.id, "new-hash");
      return token;
    });
    await expect(signTotpChallenge(user.id, user.sessionVersion)).rejects.toMatchObject({ name: "SessionInvalidatedError" });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM totp_challenges").get()).toEqual({ count: 0 });
  });
});

describe("auto-generated secret (no KOKPIT_SESSION_SECRET)", () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.KOKPIT_SESSION_SECRET;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kokpit-jwt-test-"));
    process.env.KOKPIT_DB_PATH = path.join(tmpDir, "users.db");
  });

  afterEach(() => {
    process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";
    delete process.env.KOKPIT_DB_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("signs a JWT and writes the generated secret to .session_secret", async () => {
    const { createUser } = await import("../../auth/users");
    const { signTotpChallenge } = await import("../../auth/jwt");
    const user = await createUser("secret-user", "hash");
    const token = await signTotpChallenge(user.id, user.sessionVersion);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);

    const secretPath = path.join(tmpDir, ".session_secret");
    expect(fs.existsSync(secretPath)).toBe(true);
    const secret = fs.readFileSync(secretPath, "utf-8").trim();
    expect(secret).toHaveLength(64); // 32 bytes hex-encoded
  });

  it("reuses the persisted secret so tokens survive a simulated restart", async () => {
    const { createUser } = await import("../../auth/users");
    const { signTotpChallenge } = await import("../../auth/jwt");
    const user = await createUser("restart-user", "hash");
    const token = await signTotpChallenge(user.id, user.sessionVersion);

    // Simulate a restart: fresh module, same file on disk
    const { closeDb } = await import("../../auth/db");
    closeDb();
    vi.resetModules();
    const { verifyTotpChallenge } = await import("../../auth/jwt");
    const result = await verifyTotpChallenge(token);
    expect(result?.userId).toBe(user.id);
  });
});
