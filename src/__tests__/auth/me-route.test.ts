// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";
process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    set: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
  }),
}));

describe("GET /api/auth/me", () => {
  beforeEach(() => vi.resetModules());

  it("returns 401 when no session cookie is present", async () => {
    const { cookies } = await import("next/headers");
    (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({
      set: vi.fn(),
      delete: vi.fn(),
      get: vi.fn().mockReturnValue(undefined),
    });

    const { GET } = await import("../../app/api/auth/me/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid session token", async () => {
    const { cookies } = await import("next/headers");
    (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({
      set: vi.fn(),
      delete: vi.fn(),
      get: vi.fn().mockReturnValue({ value: "invalid.token.here" }),
    });

    const { GET } = await import("../../app/api/auth/me/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 200 with user data for a valid session token", async () => {
    const { createUser, hashPassword, signJWT } = await import("@/auth");
    const hash = await hashPassword("password123");
    const user = await createUser("admin", hash);
    const token = await signJWT(user.id, 24);

    const { cookies } = await import("next/headers");
    (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({
      set: vi.fn(),
      delete: vi.fn(),
      get: vi.fn().mockReturnValue({ value: token }),
    });

    const { GET } = await import("../../app/api/auth/me/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(user.id);
    expect(json.username).toBe("admin");
  });

  it("returns 401 when the token references a non-existent user", async () => {
    const { signJWT } = await import("@/auth");
    const token = await signJWT("nonexistent-user-id", 24);

    const { cookies } = await import("next/headers");
    (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({
      set: vi.fn(),
      delete: vi.fn(),
      get: vi.fn().mockReturnValue({ value: token }),
    });

    const { GET } = await import("../../app/api/auth/me/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
