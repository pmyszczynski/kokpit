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

describe("POST /api/auth/totp/verify", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCookieSet.mockReset();
  });

  it("returns 403 without the trusted-request header", async () => {
    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const res = await POST(new globalThis.Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ challengeToken: "token", code: "123456" }),
    }));
    expect(res.status).toBe(403);
  });

  it.each([
    { name: "malformed JSON", body: (_token: string) => "{", status: 400 },
    { name: "non-object JSON", body: (_token: string) => "null", status: 400 },
    { name: "streamed overflow", body: (token: string) => JSON.stringify({ challengeToken: token, code: "000000", padding: "x".repeat(16 * 1024) }), status: 413 },
  ])("rejects $name without attempts, admission or challenge consumption", async ({ body, status }) => {
    const auth = await import("@/auth");
    const user = await auth.createUser("body-boundary-totp", "unused-hash");
    const secret = auth.generateTotpSecret();
    auth.setTotpSecret(user.id, secret);
    const challengeToken = await auth.signTotpChallenge(user.id, auth.getUserById(user.id)!.sessionVersion);
    const database = auth.getDb();
    const before = database.prepare("SELECT * FROM totp_challenges").all();
    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const response = await POST(trustedRequest("http://localhost", { method: "POST", body: body(challengeToken) }));
    expect(response.status).toBe(status);
    expect(database.prepare("SELECT * FROM totp_challenges").all()).toEqual(before);
    expect(database.prepare("SELECT * FROM login_rate_limits").all()).toEqual([]);
    expect(database.prepare("SELECT * FROM login_request_times").all()).toEqual([]);
    expect(auth.listSessions(user.id)).toEqual([]);
    expect(mockCookieSet).not.toHaveBeenCalled();
    const accepted = await POST(trustedRequest("http://localhost", {
      method: "POST", body: JSON.stringify({ challengeToken, code: generateSync({ secret }) }),
    }));
    expect(accepted.status).toBe(200);
  });

  it("returns 400 on missing fields", async () => {
    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const res = await POST(trustedRequest("http://localhost", {
      method: "POST",
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  it("returns 401 on invalid challenge token", async () => {
    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const res = await POST(trustedRequest("http://localhost", {
      method: "POST",
      body: JSON.stringify({ challengeToken: "bogus.token.value", code: "123456" }),
    }));
    expect(res.status).toBe(401);
  });

  it("returns 401 on valid challenge but wrong TOTP code", async () => {
    const { createUser, hashPassword, generateTotpSecret, setTotpSecret, signTotpChallenge, getUserById } = await import("@/auth");
    const hash = await hashPassword("pass");
    const user = await createUser("frank", hash);
    const secret = generateTotpSecret();
    setTotpSecret(user.id, secret);
    const challengeToken = await signTotpChallenge(user.id, getUserById(user.id)!.sessionVersion);

    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const res = await POST(trustedRequest("http://localhost", {
      method: "POST",
      body: JSON.stringify({ challengeToken, code: "000000" }),
    }));
    expect(res.status).toBe(401);
  });

  it.each(["1", "12345", "1234567", "12a456", "１２３４５６", "123456\n"])(
    "counts malformed OTP %j as a wrong attempt and still accepts a later valid code", async code => {
      const auth = await import("@/auth");
      const user = await auth.createUser("malformed-code", "unused-hash");
      const secret = auth.generateTotpSecret();
      auth.setTotpSecret(user.id, secret);
      const challengeToken = await auth.signTotpChallenge(user.id, auth.getUserById(user.id)!.sessionVersion);
      const database = auth.getDb();
      const { POST } = await import("../../app/api/auth/totp/verify/route");
      const request = (token: string) => POST(trustedRequest("http://localhost", {
        method: "POST", body: JSON.stringify({ challengeToken, code: token }),
      }));
      const rejected = await request(code);
      expect(rejected.status).toBe(401);
      expect(await rejected.json()).toEqual({ error: "Invalid code" });
      expect(database.prepare("SELECT attempts, state FROM totp_challenges").get()).toEqual({ attempts: 1, state: "active" });
      expect(database.prepare("SELECT attempts FROM login_rate_limits").get()).toEqual({ attempts: 1 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM login_request_times").get()).toEqual({ count: 1 });
      expect(mockCookieSet).not.toHaveBeenCalled();
      expect((await request(generateSync({ secret }))).status).toBe(200);
      expect(database.prepare("SELECT attempts, state FROM totp_challenges").get()).toEqual({ attempts: 1, state: "consumed" });
      expect(database.prepare("SELECT attempts FROM login_rate_limits").get()).toEqual({ attempts: 1 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM login_request_times").get()).toEqual({ count: 2 });
    }
  );

  it("exhausts a challenge after five malformed OTPs and rejects a later valid code without more admission", async () => {
    const auth = await import("@/auth");
    const user = await auth.createUser("malformed-exhaustion", "unused-hash");
    const secret = auth.generateTotpSecret();
    auth.setTotpSecret(user.id, secret);
    const challengeToken = await auth.signTotpChallenge(user.id, auth.getUserById(user.id)!.sessionVersion);
    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const request = (code: string) => POST(trustedRequest("http://localhost", {
      method: "POST", body: JSON.stringify({ challengeToken, code }),
    }));
    const malformed = ["1", "abcd12", "1234567", "１２３４５６", "123456\n"];
    for (const [index, code] of malformed.entries()) expect((await request(code)).status).toBe(index < 4 ? 401 : 429);
    expect((await request(generateSync({ secret }))).status).toBe(401);
    expect(auth.getDb().prepare("SELECT attempts, state FROM totp_challenges").get()).toEqual({ attempts: 5, state: "exhausted" });
    expect(auth.getDb().prepare("SELECT attempts FROM login_rate_limits").get()).toEqual({ attempts: 5 });
    expect(auth.getDb().prepare("SELECT COUNT(*) AS count FROM login_request_times").get()).toEqual({ count: 5 });
    expect(auth.listSessions(user.id)).toEqual([]);
    expect(mockCookieSet).not.toHaveBeenCalled();
  });

  it("applies the durable account allowance to malformed codes across fresh challenges", async () => {
    const auth = await import("@/auth");
    const user = await auth.createUser("malformed-shared-budget", "unused-hash");
    auth.setTotpSecret(user.id, auth.generateTotpSecret());
    const version = auth.getUserById(user.id)!.sessionVersion;
    const { POST } = await import("../../app/api/auth/totp/verify/route");
    for (let challenge = 0; challenge < 3; challenge++) {
      const challengeToken = await auth.signTotpChallenge(user.id, version);
      const request = () => POST(trustedRequest("http://localhost", {
        method: "POST", body: JSON.stringify({ challengeToken, code: "1" }),
      }));
      if (challenge < 2) {
        for (let attempt = 0; attempt < 5; attempt++) expect((await request()).status).toBe(attempt < 4 ? 401 : 429);
      } else {
        const blocked = await request();
        expect(blocked.status).toBe(429);
        expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
      }
    }
    expect(auth.getDb().prepare("SELECT attempts FROM login_rate_limits").get()).toEqual({ attempts: 10 });
    expect(auth.getDb().prepare("SELECT COUNT(*) AS count FROM login_request_times").get()).toEqual({ count: 10 });
    expect(auth.getDb().prepare("SELECT attempts FROM totp_challenges ORDER BY attempts").all())
      .toEqual([{ attempts: 0 }, { attempts: 5 }, { attempts: 5 }]);
    expect(mockCookieSet).not.toHaveBeenCalled();
  });

  it("rolls back a genuine verifier exception and allows retry instead of charging a wrong guess", async () => {
    const auth = await import("@/auth");
    const totp = await import("../../auth/totp");
    const user = await auth.createUser("verifier-failure", "unused-hash");
    const secret = auth.generateTotpSecret();
    auth.setTotpSecret(user.id, secret);
    const challengeToken = await auth.signTotpChallenge(user.id, auth.getUserById(user.id)!.sessionVersion);
    const verify = vi.spyOn(totp, "verifyTotpCode").mockImplementationOnce(() => { throw new Error("synthetic verifier failure"); });
    try {
      const { POST } = await import("../../app/api/auth/totp/verify/route");
      const request = () => POST(trustedRequest("http://localhost", {
        method: "POST", body: JSON.stringify({ challengeToken, code: generateSync({ secret }) }),
      }));
      expect((await request()).status).toBe(503);
      expect(auth.getDb().prepare("SELECT attempts, state FROM totp_challenges").get()).toEqual({ attempts: 0, state: "active" });
      expect(auth.getDb().prepare("SELECT * FROM login_rate_limits").all()).toEqual([]);
      expect(auth.getDb().prepare("SELECT * FROM login_request_times").all()).toEqual([]);
      expect(mockCookieSet).not.toHaveBeenCalled();
      expect((await request()).status).toBe(200);
    } finally { verify.mockRestore(); }
  });

  it("returns 200 and sets session cookie on valid challenge + valid code", async () => {
    const { createUser, hashPassword, generateTotpSecret, setTotpSecret, signTotpChallenge, getUserById } = await import("@/auth");
    const hash = await hashPassword("pass");
    const user = await createUser("grace", hash);
    const secret = generateTotpSecret();
    setTotpSecret(user.id, secret);
    const challengeToken = await signTotpChallenge(user.id, getUserById(user.id)!.sessionVersion);
    const code = generateSync({ secret });

    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const res = await POST(trustedRequest("http://localhost", {
      method: "POST",
      body: JSON.stringify({ challengeToken, code }),
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.username).toBe("grace");
    expect(mockCookieSet).toHaveBeenCalled();
  });

  it("revokes the inserted session after cookie failure and keeps the challenge consumed", async () => {
    const auth = await import("@/auth");
    const user = await auth.createUser("cookie-failure", "unused-hash");
    const secret = auth.generateTotpSecret();
    auth.setTotpSecret(user.id, secret);
    const challengeToken = await auth.signTotpChallenge(user.id, auth.getUserById(user.id)!.sessionVersion);
    const { POST } = await import("../../app/api/auth/totp/verify/route");
    mockCookieSet.mockImplementationOnce(() => { throw new Error("cookie store failure"); });
    const request = () => POST(trustedRequest("http://localhost", {
      method: "POST", body: JSON.stringify({ challengeToken, code: generateSync({ secret }) }),
    }));
    expect((await request()).status).toBe(503);
    expect(auth.listSessions(user.id)).toEqual([]);
    expect((await request()).status).toBe(401);
    expect(mockCookieSet).toHaveBeenCalledTimes(1);
  });

  it("does not consume a challenge when obtaining cookies fails", async () => {
    const auth = await import("@/auth");
    const user = await auth.createUser("cookie-preparation-failure", "unused-hash");
    const secret = auth.generateTotpSecret();
    auth.setTotpSecret(user.id, secret);
    const challengeToken = await auth.signTotpChallenge(user.id, auth.getUserById(user.id)!.sessionVersion);
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockRejectedValueOnce(new Error("cookie store unavailable"));
    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const request = () => POST(trustedRequest("http://localhost", {
      method: "POST", body: JSON.stringify({ challengeToken, code: generateSync({ secret }) }),
    }));
    expect((await request()).status).toBe(503);
    expect(auth.listSessions(user.id)).toEqual([]);
    expect((await request()).status).toBe(200);
  });

  it("rechecks generation after waiting for the cookie store", async () => {
    const auth = await import("@/auth");
    const user = await auth.createUser("cookie-generation-race", "old-hash");
    const secret = auth.generateTotpSecret();
    auth.setTotpSecret(user.id, secret);
    const challengeToken = await auth.signTotpChallenge(user.id, auth.getUserById(user.id)!.sessionVersion);
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockImplementationOnce(async () => {
      auth.updatePasswordHash(user.id, "new-hash");
      return { get: vi.fn(), set: mockCookieSet, delete: vi.fn() } as unknown as Awaited<ReturnType<typeof cookies>>;
    });
    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const response = await POST(trustedRequest("http://localhost", {
      method: "POST", body: JSON.stringify({ challengeToken, code: generateSync({ secret }) }),
    }));
    expect(response.status).toBe(401);
    expect(auth.listSessions(user.id)).toEqual([]);
    expect(mockCookieSet).not.toHaveBeenCalled();
  });

  it("returns a controlled retry if inserting the session fails, then accepts the same challenge", async () => {
    const auth = await import("@/auth");
    const user = await auth.createUser("session-insert-failure", "unused-hash");
    const secret = auth.generateTotpSecret();
    auth.setTotpSecret(user.id, secret);
    const challengeToken = await auth.signTotpChallenge(user.id, auth.getUserById(user.id)!.sessionVersion);
    auth.getDb().exec("CREATE TRIGGER reject_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'synthetic storage failure'); END;");
    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const request = () => POST(trustedRequest("http://localhost", {
      method: "POST", body: JSON.stringify({ challengeToken, code: generateSync({ secret }) }),
    }));
    expect((await request()).status).toBe(503);
    expect(auth.listSessions(user.id)).toEqual([]);
    expect(mockCookieSet).not.toHaveBeenCalled();
    auth.getDb().exec("DROP TRIGGER reject_session");
    expect((await request()).status).toBe(200);
  });

  it("allows only one of two simultaneous submissions of the same challenge", async () => {
    const { createUser, getDb, hashPassword, generateTotpSecret, setTotpSecret, signTotpChallenge, getUserById } = await import("@/auth");
    const user = await createUser("challenge-replay", await hashPassword("pass"));
    const secret = generateTotpSecret();
    setTotpSecret(user.id, secret);
    const challengeToken = await signTotpChallenge(user.id, getUserById(user.id)!.sessionVersion);
    const code = generateSync({ secret });
    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const request = () => POST(trustedRequest("http://localhost", {
      method: "POST", body: JSON.stringify({ challengeToken, code }),
    }));

    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    const { count } = getDb().prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?")
      .get(user.id) as { count: number };
    expect(count).toBe(1);
  });

  it("returns 401 when challenge is for a user without TOTP set", async () => {
    const { createUser, hashPassword, signTotpChallenge, getUserById } = await import("@/auth");
    const hash = await hashPassword("pass");
    const user = await createUser("henry", hash);
    const challengeToken = await signTotpChallenge(user.id, getUserById(user.id)!.sessionVersion);

    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const res = await POST(trustedRequest("http://localhost", {
      method: "POST",
      body: JSON.stringify({ challengeToken, code: "123456" }),
    }));
    expect(res.status).toBe(401);
  });

  it("rejects a pending challenge after a password reset changes the user generation", async () => {
    const { createUser, hashPassword, generateTotpSecret, setTotpSecret, signTotpChallenge, getUserById, updatePasswordHash } = await import("@/auth");
    const user = await createUser("challenge-reset", await hashPassword("old-password"));
    const secret = generateTotpSecret();
    setTotpSecret(user.id, secret);
    const challengeToken = await signTotpChallenge(user.id, getUserById(user.id)!.sessionVersion);
    updatePasswordHash(user.id, await hashPassword("new-password"));

    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const res = await POST(trustedRequest("http://localhost", {
      method: "POST", body: JSON.stringify({ challengeToken, code: generateSync({ secret }) }),
    }));
    expect(res.status).toBe(401);
  });

  it("returns 429 and invalidates token after 5 failed attempts", async () => {
    const { createUser, hashPassword, generateTotpSecret, setTotpSecret, signTotpChallenge, getUserById } = await import("@/auth");
    const hash = await hashPassword("pass");
    const user = await createUser("ivan", hash);
    const secret = generateTotpSecret();
    setTotpSecret(user.id, secret);
    const challengeToken = await signTotpChallenge(user.id, getUserById(user.id)!.sessionVersion);

    const { POST } = await import("../../app/api/auth/totp/verify/route");
    const makeRequest = () => POST(trustedRequest("http://localhost", {
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

  it("limits TOTP guesses across fresh password login challenges for the same account", async () => {
    const auth = await import("@/auth");
    const user = await auth.createUser("fresh-challenges", await auth.hashPassword("known-password"));
    auth.setTotpSecret(user.id, auth.generateTotpSecret());
    const totp = await import("../../auth/totp");
    const verifyTotpCode = vi.spyOn(totp, "verifyTotpCode").mockReturnValue(false);
    try {
      const { POST } = await import("../../app/api/auth/totp/verify/route");
      const { POST: login } = await import("../../app/api/auth/login/route");
      for (let i = 0; i < 11; i++) {
        const passwordStep = await login(trustedRequest("http://localhost", {
          method: "POST", body: JSON.stringify({ username: user.username, password: "known-password" }),
        }));
        expect(passwordStep.status).toBe(200);
        const { challengeToken } = await passwordStep.json();
        const response = await POST(trustedRequest("http://localhost", {
          method: "POST", body: JSON.stringify({ challengeToken, code: "000000" }),
        }));
        expect(response.status).toBe(i < 10 ? 401 : 429);
        if (i === 10) expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
      }
      expect(verifyTotpCode).toHaveBeenCalledTimes(10);
      expect(mockCookieSet).not.toHaveBeenCalled();
    } finally {
      verifyTotpCode.mockRestore();
    }
  });

  it("releases successful TOTP checks so normal MFA logins remain available", async () => {
    const auth = await import("@/auth");
    const user = await auth.createUser("successful-mfa", "unused-hash");
    const secret = auth.generateTotpSecret();
    auth.setTotpSecret(user.id, secret);
    const version = auth.getUserById(user.id)!.sessionVersion;
    const { POST } = await import("../../app/api/auth/totp/verify/route");
    for (let i = 0; i < 12; i++) {
      const challengeToken = await auth.signTotpChallenge(user.id, version);
      const response = await POST(trustedRequest("http://localhost", {
        method: "POST", body: JSON.stringify({ challengeToken, code: generateSync({ secret }) }),
      }));
      expect(response.status).toBe(200);
    }
  });
});
