// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";
process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";

const mockCookieGet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: mockCookieGet,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));

async function makeSessionCookie(userId: string): Promise<string> {
  const { signJWT } = await import("@/auth");
  return signJWT(userId, 24);
}

describe("POST /api/auth/recovery-code", () => {
  beforeEach(() => vi.resetModules());

  it("returns 401 when not authenticated", async () => {
    mockCookieGet.mockReturnValue(undefined);
    const { POST } = await import("../../app/api/auth/recovery-code/route");
    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ password: "whatever" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when the password is wrong", async () => {
    const { createUser, hashPassword } = await import("@/auth");
    const hash = await hashPassword("correctpassword");
    const user = await createUser("alice", hash);
    const token = await makeSessionCookie(user.id);
    mockCookieGet.mockReturnValue({ value: token });

    const { POST } = await import("../../app/api/auth/recovery-code/route");
    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ password: "wrongpassword" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when password is missing", async () => {
    const { createUser, hashPassword } = await import("@/auth");
    const hash = await hashPassword("correctpassword");
    const user = await createUser("bob", hash);
    const token = await makeSessionCookie(user.id);
    mockCookieGet.mockReturnValue({ value: token });

    const { POST } = await import("../../app/api/auth/recovery-code/route");
    const res = await POST(
      new Request("http://localhost", { method: "POST", body: JSON.stringify({}) })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when the JSON body is null", async () => {
    const { createUser, hashPassword } = await import("@/auth");
    const hash = await hashPassword("correctpassword");
    const user = await createUser("dave", hash);
    const token = await makeSessionCookie(user.id);
    mockCookieGet.mockReturnValue({ value: token });

    const { POST } = await import("../../app/api/auth/recovery-code/route");
    const res = await POST(
      new Request("http://localhost", { method: "POST", body: "null" })
    );
    expect(res.status).toBe(400);
  });

  it("issues a new recovery code and overwrites the old one", async () => {
    const { createUser, hashPassword, generateRecoveryCode, hashRecoveryCode, setRecoveryCodeHash, getUserById, verifyRecoveryCode } =
      await import("@/auth");
    const hash = await hashPassword("correctpassword");
    const user = await createUser("carol", hash);
    const oldCode = generateRecoveryCode();
    setRecoveryCodeHash(user.id, hashRecoveryCode(oldCode));
    const token = await makeSessionCookie(user.id);
    mockCookieGet.mockReturnValue({ value: token });

    const { POST } = await import("../../app/api/auth/recovery-code/route");
    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ password: "correctpassword" }),
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recoveryCode).not.toBe(oldCode);

    const updated = getUserById(user.id);
    expect(verifyRecoveryCode(oldCode, updated!.recoveryCodeHash!)).toBe(false);
    expect(verifyRecoveryCode(json.recoveryCode, updated!.recoveryCodeHash!)).toBe(true);
  });
});
