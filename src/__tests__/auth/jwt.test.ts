// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.KOKPIT_SESSION_SECRET =
    "test-secret-32-chars-minimum-length-xx";
});

describe("signJWT()", () => {
  it("returns a JWT string (3 dot-separated parts)", async () => {
    const { signJWT } = await import("../../auth/jwt");
    const token = await signJWT("user-123", 24);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
  });
});

describe("verifyJWT()", () => {
  it("returns userId for a valid token", async () => {
    const { signJWT, verifyJWT } = await import("../../auth/jwt");
    const token = await signJWT("user-abc", 24);
    const payload = await verifyJWT(token);
    expect(payload?.userId).toBe("user-abc");
  });

  it("returns null for a tampered token", async () => {
    const { signJWT, verifyJWT } = await import("../../auth/jwt");
    const token = await signJWT("user-xyz", 24);
    const tampered = token.slice(0, -5) + "XXXXX";
    expect(await verifyJWT(tampered)).toBeNull();
  });

  it("returns null for a random string", async () => {
    const { verifyJWT } = await import("../../auth/jwt");
    expect(await verifyJWT("not.a.token")).toBeNull();
  });

  it("returns null for a totp_challenge token (must not be accepted as a session)", async () => {
    const { signTotpChallenge, verifyJWT, verifyTotpChallenge } = await import("../../auth/jwt");
    const token = await signTotpChallenge("user-123");
    expect(await verifyJWT(token)).toBeNull();
    expect((await verifyTotpChallenge(token))?.userId).toBe("user-123");
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
    const { signJWT } = await import("../../auth/jwt");
    const token = await signJWT("user-1", 1);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);

    const secretPath = path.join(tmpDir, ".session_secret");
    expect(fs.existsSync(secretPath)).toBe(true);
    const secret = fs.readFileSync(secretPath, "utf-8").trim();
    expect(secret).toHaveLength(64); // 32 bytes hex-encoded
  });

  it("reuses the persisted secret so tokens survive a simulated restart", async () => {
    const { signJWT } = await import("../../auth/jwt");
    const token = await signJWT("user-123", 1);

    // Simulate a restart: fresh module, same file on disk
    vi.resetModules();
    const { verifyJWT } = await import("../../auth/jwt");
    const result = await verifyJWT(token);
    expect(result?.userId).toBe("user-123");
  });
});
