// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";
process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";

// Mock getConfig so no real settings.yaml is needed
vi.mock("@/config/server", () => ({
  getConfig: vi.fn().mockReturnValue({
    auth: { enabled: true, session_ttl_hours: 24 },
  }),
}));

// Mock next/headers (not available outside Next.js runtime)
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    set: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
  }),
}));
vi.mock("@/auth/requestGuard", () => ({ isTrustedMutation: vi.fn().mockReturnValue(true) }));

describe("POST /api/auth/login", () => {
  beforeEach(() => vi.resetModules());

  it("returns 200 on valid credentials", async () => {
    const { createUser, hashPassword } = await import("@/auth");
    const hash = await hashPassword("correctpassword");
    await createUser("admin", hash);

    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "admin", password: "correctpassword" }),
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.username).toBe("admin");
  });

  it("returns 401 on invalid password", async () => {
    const { createUser, hashPassword } = await import("@/auth");
    const hash = await hashPassword("correctpassword");
    await createUser("admin2", hash);

    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "admin2", password: "wrongpassword" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 on unknown username", async () => {
    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "nobody", password: "pass" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 on missing fields", async () => {
    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "admin" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns requiresTotp and challengeToken when user has TOTP enabled", async () => {
    const { createUser, hashPassword, generateTotpSecret, setTotpSecret } = await import("@/auth");
    const hash = await hashPassword("mypassword");
    const user = await createUser("totp_user", hash);
    setTotpSecret(user.id, generateTotpSecret());

    const mockSet = vi.fn();
    const { cookies } = await import("next/headers");
    (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({ set: mockSet, delete: vi.fn(), get: vi.fn() });

    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "totp_user", password: "mypassword" }),
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.requiresTotp).toBe(true);
    expect(typeof json.challengeToken).toBe("string");
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("rejects an old-password TOTP login that races with a password reset", async () => {
    const auth = await import("@/auth");
    const user = await auth.createUser("totp-password-race", await auth.hashPassword("old-password"));
    auth.setTotpSecret(user.id, auth.generateTotpSecret());

    let releaseVerification: (() => void) | undefined;
    const verificationPaused = new Promise<void>((resolve) => { releaseVerification = resolve; });
    let verificationStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { verificationStarted = resolve; });
    vi.doMock("@/auth", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/auth")>()),
      verifyPassword: async () => {
        verificationStarted?.();
        await verificationPaused;
        return true;
      },
    }));
    const { POST } = await import("../../app/api/auth/login/route");
    const login = POST(new Request("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "totp-password-race", password: "old-password" }),
    }));
    await started;
    auth.updatePasswordHash(user.id, await auth.hashPassword("new-password"));
    releaseVerification?.();

    expect((await login).status).toBe(401);
    vi.doUnmock("@/auth");
  });

  it("keeps the verified generation when a CLI reset wins just before challenge signing", async () => {
    const auth = await import("@/auth");
    const user = await auth.createUser("cli-reset-race", await auth.hashPassword("old-password"));
    auth.setTotpSecret(user.id, auth.generateTotpSecret());
    const version = auth.getUserById(user.id)!.sessionVersion;
    const signer = vi.fn((id: string, expectedVersion: number) => {
      auth.updatePasswordHash(id, "new-password-hash");
      return auth.signTotpChallenge(id, expectedVersion);
    });
    vi.doMock("@/auth", () => ({ ...auth, signTotpChallenge: signer }));
    try {
      const { POST } = await import("../../app/api/auth/login/route");
      const response = await POST(new Request("http://localhost/api/auth/login", {
        method: "POST", body: JSON.stringify({ username: "cli-reset-race", password: "old-password" }),
      }));
      expect(response.status).toBe(401);
      expect(signer).toHaveBeenCalledWith(user.id, version);
    } finally { vi.doUnmock("@/auth"); }
  });

  it("sets the session cookie on successful login", async () => {
    const { createUser, hashPassword } = await import("@/auth");
    const hash = await hashPassword("password123");
    await createUser("cookieuser", hash);

    const mockSet = vi.fn();
    const { cookies } = await import("next/headers");
    (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({ set: mockSet, delete: vi.fn(), get: vi.fn() });

    const { POST } = await import("../../app/api/auth/login/route");
    await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "cookieuser", password: "password123" }),
      })
    );
    expect(mockSet).toHaveBeenCalledWith(
      "session",
      expect.any(String),
      expect.objectContaining({ httpOnly: true })
    );
  });

  it("returns the user id and username in the response body", async () => {
    const { createUser, hashPassword } = await import("@/auth");
    const hash = await hashPassword("pass1234");
    const user = await createUser("bodyuser", hash);

    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "bodyuser", password: "pass1234" }),
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(user.id);
    expect(json.username).toBe("bodyuser");
  });

  it("returns 400 on invalid JSON body", async () => {
    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: "not-valid-json",
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 on empty username", async () => {
    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "", password: "somepassword" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 on empty password", async () => {
    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "admin", password: "" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when username is not a string", async () => {
    const { POST } = await import("../../app/api/auth/login/route");
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: 42, password: "somepassword" }),
      })
    );
    expect(res.status).toBe(400);
  });
});
