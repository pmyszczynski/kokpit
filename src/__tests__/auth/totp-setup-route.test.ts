// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSync } from "otplib";

process.env.KOKPIT_DB_PATH = ":memory:";
process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";

const mockCookieGet = vi.fn();
const mockCookieSet = vi.fn();
const mockCookieDelete = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: mockCookieGet,
    set: mockCookieSet,
    delete: mockCookieDelete,
  }),
}));

vi.mock("@/config/server", () => ({
  getConfig: vi.fn().mockReturnValue({
    auth: { enabled: true, session_ttl_hours: 24 },
  }),
}));

function trustedRequest(input: RequestInfo | URL, init?: RequestInit): globalThis.Request {
  const headers = new Headers(init?.headers);
  headers.set("x-kokpit-request", "1");
  return new globalThis.Request(input, { ...init, headers });
}

async function makeSessionCookie(userId: string): Promise<string> {
  const { createSession } = await import("@/auth");
  return createSession(userId).token;
}

describe("GET /api/auth/totp/setup", () => {
  beforeEach(() => vi.resetModules());

  it("returns 403 without the trusted-request header", async () => {
    const { POST } = await import("../../app/api/auth/totp/setup/route");
    const res = await POST(new globalThis.Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ secret: "abc", code: "123456", password: "whatever" }),
    }));
    expect(res.status).toBe(403);
  });

  it("returns 401 when not authenticated", async () => {
    mockCookieGet.mockReturnValue(undefined);
    const { GET } = await import("../../app/api/auth/totp/setup/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns enabled:false with secret and qrCode when TOTP not set up", async () => {
    const { createUser, hashPassword } = await import("@/auth");
    const hash = await hashPassword("pass");
    const user = await createUser("alice", hash);
    const token = await makeSessionCookie(user.id);
    mockCookieGet.mockReturnValue({ value: token });

    const { GET } = await import("../../app/api/auth/totp/setup/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enabled).toBe(false);
    expect(typeof json.secret).toBe("string");
    expect(typeof json.qrCode).toBe("string");
    expect(json.qrCode).toMatch(/^data:image\/png;base64,/);
  });

  it("returns enabled:true when TOTP is already set", async () => {
    const { createUser, hashPassword, setTotpSecret, generateTotpSecret } = await import("@/auth");
    const hash = await hashPassword("pass");
    const user = await createUser("bob", hash);
    setTotpSecret(user.id, generateTotpSecret());
    const token = await makeSessionCookie(user.id);
    mockCookieGet.mockReturnValue({ value: token });

    const { GET } = await import("../../app/api/auth/totp/setup/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.enabled).toBe(true);
  });
});

describe("POST /api/auth/totp/setup", () => {
  beforeEach(() => vi.resetModules());

  it("returns 401 when not authenticated", async () => {
    mockCookieGet.mockReturnValue(undefined);
    const { POST } = await import("../../app/api/auth/totp/setup/route");
    const res = await POST(trustedRequest("http://localhost", {
      method: "POST",
      body: JSON.stringify({ secret: "abc", code: "123456", password: "whatever" }),
    }));
    expect(res.status).toBe(401);
  });

  it("enables TOTP with valid code", async () => {
    const { createUser, hashPassword, generateTotpSecret } = await import("@/auth");
    const hash = await hashPassword("pass");
    const user = await createUser("carol", hash);
    const token = await makeSessionCookie(user.id);
    mockCookieGet.mockReturnValue({ value: token });

    const secret = generateTotpSecret();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const code = generateSync({ secret });

    const { POST } = await import("../../app/api/auth/totp/setup/route");
    const res = await POST(trustedRequest("http://localhost", {
      method: "POST",
      body: JSON.stringify({ secret, code, password: "pass" }),
    }));
    vi.useRealTimers();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("requires the current password and revokes other sessions when enabling 2FA", async () => {
    const { createSession, createUser, getAuthSession, hashPassword, generateTotpSecret } = await import("@/auth");
    const user = await createUser("two-factor-revoke", await hashPassword("correct-password"));
    const current = createSession(user.id).token;
    const other = createSession(user.id).token;
    mockCookieGet.mockReturnValue({ value: current });
    const secret = generateTotpSecret();
    const code = generateSync({ secret });
    const { POST } = await import("../../app/api/auth/totp/setup/route");

    const wrongPassword = await POST(trustedRequest("http://localhost", {
      method: "POST", body: JSON.stringify({ secret, code, password: "wrong-password" }),
    }));
    expect(wrongPassword.status).toBe(401);

    const valid = await POST(trustedRequest("http://localhost", {
      method: "POST", body: JSON.stringify({ secret, code, password: "correct-password" }),
    }));
    expect(valid.status).toBe(200);
    expect(await getAuthSession(current)).not.toBeNull();
    expect(await getAuthSession(other)).toBeNull();
  });

  it("returns 409 when TOTP is already enabled", async () => {
    const { createUser, hashPassword, generateTotpSecret, setTotpSecret } = await import("@/auth");
    const hash = await hashPassword("pass");
    const user = await createUser("ivan", hash);
    setTotpSecret(user.id, generateTotpSecret());
    const token = await makeSessionCookie(user.id);
    mockCookieGet.mockReturnValue({ value: token });

    const { POST } = await import("../../app/api/auth/totp/setup/route");
    const res = await POST(trustedRequest("http://localhost", {
      method: "POST",
      body: JSON.stringify({ secret: generateTotpSecret(), code: "123456", password: "pass" }),
    }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/already enabled/i);
  });

  it("returns 409 when the 2FA state changes while the request is being verified", async () => {
    const auth = await import("@/auth");
    const user = await auth.createUser("totp-stale-state", await auth.hashPassword("pass"));
    const token = auth.createSession(user.id).token;
    mockCookieGet.mockReturnValue({ value: token });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
    try {
      const secret = auth.generateTotpSecret();
      const code = generateSync({ secret });
      const winningSecret = auth.generateTotpSecret();
      vi.doMock("@/auth", () => ({
        ...auth,
        updateTotpSecretAndRevokeOtherSessions: (...args: Parameters<typeof auth.updateTotpSecretAndRevokeOtherSessions>) => {
          // Another request from this session commits after password verification.
          expect(auth.updateTotpSecretAndRevokeOtherSessions(
            args[0], args[1], args[2], args[3], winningSecret
          )).toBe("updated");
          return auth.updateTotpSecretAndRevokeOtherSessions(...args);
        },
      }));
      const { POST } = await import("../../app/api/auth/totp/setup/route");
      const response = await POST(trustedRequest("http://localhost", {
        method: "POST", body: JSON.stringify({ secret, code, password: "pass" }),
      }));
      expect(response.status).toBe(409);
      expect(auth.getUserById(user.id)?.totpSecret).toBe(winningSecret);
    } finally {
      vi.doUnmock("@/auth");
      vi.useRealTimers();
    }
  });

  it("returns 400 on invalid code", async () => {
    const { createUser, hashPassword, generateTotpSecret } = await import("@/auth");
    const hash = await hashPassword("pass");
    const user = await createUser("dave", hash);
    const token = await makeSessionCookie(user.id);
    mockCookieGet.mockReturnValue({ value: token });

    const { POST } = await import("../../app/api/auth/totp/setup/route");
    const res = await POST(trustedRequest("http://localhost", {
      method: "POST",
      body: JSON.stringify({ secret: generateTotpSecret(), code: "000000", password: "pass" }),
    }));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/auth/totp/setup", () => {
  beforeEach(() => vi.resetModules());

  it("returns 401 when not authenticated", async () => {
    mockCookieGet.mockReturnValue(undefined);
    const { DELETE } = await import("../../app/api/auth/totp/setup/route");
    const res = await DELETE(trustedRequest("http://localhost", {
      method: "DELETE",
      body: JSON.stringify({ code: "123456" }),
    }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when code is missing", async () => {
    const { createUser, hashPassword, generateTotpSecret, setTotpSecret } = await import("@/auth");
    const hash = await hashPassword("pass");
    const user = await createUser("frank", hash);
    setTotpSecret(user.id, generateTotpSecret());
    const token = await makeSessionCookie(user.id);
    mockCookieGet.mockReturnValue({ value: token });

    const { DELETE } = await import("../../app/api/auth/totp/setup/route");
    const res = await DELETE(trustedRequest("http://localhost", {
      method: "DELETE",
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when code is invalid", async () => {
    const { createUser, hashPassword, generateTotpSecret, setTotpSecret } = await import("@/auth");
    const hash = await hashPassword("pass");
    const user = await createUser("grace", hash);
    setTotpSecret(user.id, generateTotpSecret());
    const token = await makeSessionCookie(user.id);
    mockCookieGet.mockReturnValue({ value: token });

    const { DELETE } = await import("../../app/api/auth/totp/setup/route");
    const res = await DELETE(trustedRequest("http://localhost", {
      method: "DELETE",
      body: JSON.stringify({ code: "000000" }),
    }));
    expect(res.status).toBe(400);
  });

  it("clears TOTP secret and returns ok with valid code", async () => {
    const { createUser, hashPassword, generateTotpSecret, setTotpSecret } = await import("@/auth");
    const hash = await hashPassword("pass");
    const user = await createUser("eve", hash);
    const secret = generateTotpSecret();
    setTotpSecret(user.id, secret);
    const token = await makeSessionCookie(user.id);
    mockCookieGet.mockReturnValue({ value: token });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const code = generateSync({ secret });

    const { DELETE } = await import("../../app/api/auth/totp/setup/route");
    const res = await DELETE(trustedRequest("http://localhost", {
      method: "DELETE",
      body: JSON.stringify({ code }),
    }));
    vi.useRealTimers();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("rolls back a 2FA removal when revoking other sessions fails", async () => {
    const { createSession, createUser, generateTotpSecret, getDb, getUserById, hashPassword, setTotpSecret } = await import("@/auth");
    const user = await createUser("totp-rollback", await hashPassword("pass"));
    const secret = generateTotpSecret();
    setTotpSecret(user.id, secret);
    const token = createSession(user.id).token;
    createSession(user.id);
    mockCookieGet.mockReturnValue({ value: token });
    const versionBefore = getUserById(user.id)!.sessionVersion;
    getDb().exec(`
      CREATE TRIGGER abort_totp_session_revoke
      BEFORE DELETE ON sessions
      WHEN OLD.user_id = '${user.id}'
      BEGIN SELECT RAISE(ABORT, 'session delete failed'); END;
    `);
    const code = generateSync({ secret });
    const { DELETE } = await import("../../app/api/auth/totp/setup/route");

    await expect(DELETE(trustedRequest("http://localhost", {
      method: "DELETE", body: JSON.stringify({ code }),
    }))).rejects.toThrow("session delete failed");
    const userAfter = getUserById(user.id)!;
    expect(userAfter.totpSecret).toBe(secret);
    expect(userAfter.sessionVersion).toBe(versionBefore);
  });
});
