// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";
process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";

describe("getAuthUser()", () => {
  beforeEach(() => vi.resetModules());

  it("returns null when token is undefined", async () => {
    const { getAuthUser } = await import("../../auth/session");
    expect(await getAuthUser(undefined)).toBeNull();
  });

  it("returns null for an invalid token", async () => {
    const { getAuthUser } = await import("../../auth/session");
    expect(await getAuthUser("not-a-valid-jwt")).toBeNull();
  });

  it("returns the user when token is valid", async () => {
    const { signJWT } = await import("../../auth/jwt");
    const { createUser } = await import("../../auth/users");
    const { getAuthUser } = await import("../../auth/session");

    const user = await createUser("testuser", "hash");
    const token = await signJWT(user.id, 24);
    const result = await getAuthUser(token);
    expect(result?.username).toBe("testuser");
  });

  it("returns null when token points to non-existent user", async () => {
    const { signJWT } = await import("../../auth/jwt");
    const { getAuthUser } = await import("../../auth/session");

    const token = await signJWT("non-existent-user-id", 24);
    expect(await getAuthUser(token)).toBeNull();
  });
});
