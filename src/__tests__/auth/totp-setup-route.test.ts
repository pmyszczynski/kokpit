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

vi.mock("@/config", () => ({
  getConfig: vi.fn().mockReturnValue({
    auth: { enabled: true, session_ttl_hours: 24 },
  }),
}));

async function makeSessionCookie(userId: string): Promise<string> {
  const { signJWT } = await import("@/auth");
  return signJWT(userId, 24);
}

describe("GET /api/auth/totp/setup", () => {
  beforeEach(() => vi.resetModules());

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
    const res = await POST(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ secret: "abc", code: "123456" }),
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
    const res = await POST(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ secret, code }),
    }));
    vi.useRealTimers();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("returns 400 on invalid code", async () => {
    const { createUser, hashPassword, generateTotpSecret } = await import("@/auth");
    const hash = await hashPassword("pass");
    const user = await createUser("dave", hash);
    const token = await makeSessionCookie(user.id);
    mockCookieGet.mockReturnValue({ value: token });

    const { POST } = await import("../../app/api/auth/totp/setup/route");
    const res = await POST(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ secret: generateTotpSecret(), code: "000000" }),
    }));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/auth/totp/setup", () => {
  beforeEach(() => vi.resetModules());

  it("returns 401 when not authenticated", async () => {
    mockCookieGet.mockReturnValue(undefined);
    const { DELETE } = await import("../../app/api/auth/totp/setup/route");
    const res = await DELETE(new Request("http://localhost", {
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
    const res = await DELETE(new Request("http://localhost", {
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
    const res = await DELETE(new Request("http://localhost", {
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
    const res = await DELETE(new Request("http://localhost", {
      method: "DELETE",
      body: JSON.stringify({ code }),
    }));
    vi.useRealTimers();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});
