// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";

beforeAll(() => {
  process.env.KOKPIT_SESSION_SECRET =
    "test-secret-32-chars-minimum-length-xx";
});

describe("TOTP challenges", () => {
  beforeEach(async () => {
    const { closeDb } = await import("../../auth/db");
    closeDb();
    vi.resetModules();
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
    vi.resetModules();
    const { verifyTotpChallenge } = await import("../../auth/jwt");
    const result = await verifyTotpChallenge(token);
    expect(result?.userId).toBe(user.id);
  });
});
