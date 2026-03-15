// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSync } from "otplib";

process.env.KOKPIT_DB_PATH = ":memory:";
process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";

const mockCookieSet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: mockCookieSet,
    delete: vi.fn(),
  }),
}));

vi.mock("@/config", () => ({
  getConfig: vi.fn().mockReturnValue({
    auth: { enabled: true, session_ttl_hours: 24 },
  }),
}));

describe("POST /api/auth/totp/verify", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCookieSet.mockClear();
  });

  it("returns 400 on missing fields", async () => {
    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const res = await POST(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  it("returns 401 on invalid challenge token", async () => {
    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const res = await POST(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ challengeToken: "bogus.token.value", code: "123456" }),
    }));
    expect(res.status).toBe(401);
  });

  it("returns 401 on valid challenge but wrong TOTP code", async () => {
    const { createUser, hashPassword, generateTotpSecret, setTotpSecret, signTotpChallenge } = await import("@/auth");
    const hash = await hashPassword("pass");
    const user = await createUser("frank", hash);
    const secret = generateTotpSecret();
    setTotpSecret(user.id, secret);
    const challengeToken = await signTotpChallenge(user.id);

    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const res = await POST(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ challengeToken, code: "000000" }),
    }));
    expect(res.status).toBe(401);
  });

  it("returns 200 and sets session cookie on valid challenge + valid code", async () => {
    const { createUser, hashPassword, generateTotpSecret, setTotpSecret, signTotpChallenge } = await import("@/auth");
    const hash = await hashPassword("pass");
    const user = await createUser("grace", hash);
    const secret = generateTotpSecret();
    setTotpSecret(user.id, secret);
    const challengeToken = await signTotpChallenge(user.id);
    const code = generateSync({ secret });

    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const res = await POST(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ challengeToken, code }),
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.username).toBe("grace");
    expect(mockCookieSet).toHaveBeenCalled();
  });

  it("returns 401 when challenge is for a user without TOTP set", async () => {
    const { createUser, hashPassword, signTotpChallenge } = await import("@/auth");
    const hash = await hashPassword("pass");
    const user = await createUser("henry", hash);
    const challengeToken = await signTotpChallenge(user.id);

    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const res = await POST(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ challengeToken, code: "123456" }),
    }));
    expect(res.status).toBe(401);
  });

  it("returns 429 and invalidates token after 5 failed attempts", async () => {
    const { createUser, hashPassword, generateTotpSecret, setTotpSecret, signTotpChallenge } = await import("@/auth");
    const hash = await hashPassword("pass");
    const user = await createUser("ivan", hash);
    const secret = generateTotpSecret();
    setTotpSecret(user.id, secret);
    const challengeToken = await signTotpChallenge(user.id);

    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const makeRequest = () => POST(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ challengeToken, code: "000000" }),
    }));

    for (let i = 0; i < 4; i++) {
      const res = await makeRequest();
      expect(res.status).toBe(401);
    }
    // 5th attempt triggers lockout
    const res = await makeRequest();
    expect(res.status).toBe(429);

    // Subsequent attempt with the same token is rejected immediately
    const resAfter = await makeRequest();
    expect(resAfter.status).toBe(401);
  });
});
