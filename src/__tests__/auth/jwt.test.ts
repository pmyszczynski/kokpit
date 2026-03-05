// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";

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
});
