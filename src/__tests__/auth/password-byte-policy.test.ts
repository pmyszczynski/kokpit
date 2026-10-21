// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { decodeJwt } from "jose";
import { generateSync } from "otplib";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.KOKPIT_DB_PATH = ":memory:";
process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";

const cookie = vi.hoisted(() => ({ token: undefined as string | undefined, set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: () => cookie.token ? { value: cookie.token } : undefined,
  set: (name: string, value: string) => { cookie.token = value; cookie.set(name, value); },
  delete: () => { cookie.token = undefined; },
}) }));
vi.mock("@/config/server", () => ({ getConfig: () => ({ auth: { enabled: true, session_idle_timeout_hours: 0 } }) }));

beforeEach(() => {
  vi.resetModules();
  cookie.token = undefined;
  cookie.set.mockClear();
});

/** Build the same trusted JSON mutations used by the browser forms. */
function request(body: unknown): Request {
  return new Request("http://localhost", {
    method: "POST", headers: { "x-kokpit-request": "1", "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("password-setting boundaries", () => {
  it("rejects overlong setup input before hashing or creating an account", async () => {
    const auth = await import("@/auth");
    const { POST } = await import("@/app/api/setup/route");
    const hash = vi.spyOn(bcrypt, "hash");
    try {
      const response = await POST(request({ username: "admin", password: "😀".repeat(19) }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "password_too_long" });
      expect(hash).not.toHaveBeenCalled();
      expect(auth.countUsers()).toBe(0);
    } finally { hash.mockRestore(); }
  });

  it("rejects overlong replacement without consuming recovery proof or revoking credentials", async () => {
    const auth = await import("@/auth");
    const user = await auth.createUser("replacement", await auth.hashPassword("original password"));
    const secret = auth.generateTotpSecret();
    auth.setTotpSecret(user.id, secret);
    const recoveryCode = auth.generateRecoveryCode();
    auth.setRecoveryCodeHash(user.id, auth.hashRecoveryCode(recoveryCode));
    const previous = auth.getUserById(user.id)!;
    const session = auth.createSession(user.id);
    const challenge = await auth.signTotpChallenge(user.id, previous.sessionVersion);
    const { POST } = await import("@/app/api/auth/reset-password/route");
    const hash = vi.spyOn(bcrypt, "hash");
    try {
      const response = await POST(request({ username: user.username, recoveryCode, newPassword: "x".repeat(73) }));
      expect(response.status).toBe(400);
      expect(hash).not.toHaveBeenCalled();
      expect(auth.getUserById(user.id)).toEqual(previous);
      expect(await auth.getAuthSession(session.token)).not.toBeNull();
      expect(await auth.verifyTotpChallenge(challenge)).not.toBeNull();
    } finally { hash.mockRestore(); }
    const accepted = await POST(request({ username: user.username, recoveryCode, newPassword: "n".repeat(72) }));
    expect(accepted.status).toBe(200);
    expect(auth.getUserById(user.id)?.recoveryCodeHash).toBeNull();
    expect(await auth.getAuthSession(session.token)).toBeNull();
    expect(await auth.verifyTotpChallenge(challenge)).toBeNull();
    expect(await auth.verifyPassword("original password", auth.getUserById(user.id)!.passwordHash)).toBe(false);
    expect(await auth.verifyPassword("n".repeat(72), auth.getUserById(user.id)!.passwordHash)).toBe(true);
  });
});

describe("authenticated legacy-password guidance", () => {
  it("retains the authenticated recommendation after reopening the database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kokpit-password-guidance-"));
    process.env.KOKPIT_DB_PATH = join(directory, "users.db");
    const auth = await import("@/auth");
    try {
      const prefix = "x".repeat(72);
      await auth.createUser("persistent-hint", await bcrypt.hash(prefix + "legacy", 10));
      const { POST } = await import("@/app/api/auth/login/route");
      expect((await POST(request({ username: "persistent-hint", password: prefix + "candidate" }))).status).toBe(200);
      auth.closeDb();
      const { GET } = await import("@/app/api/auth/me/route");
      expect(await (await GET()).json()).toMatchObject({ passwordReplacementRecommended: true });
    } finally {
      auth.closeDb();
      process.env.KOKPIT_DB_PATH = ":memory:";
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps legacy suffix verification and session password proof compatible", async () => {
    const auth = await import("@/auth");
    const prefix = "a".repeat(72);
    const user = await auth.createUser("legacy", await bcrypt.hash(prefix + "original suffix", 10));
    const { POST } = await import("@/app/api/auth/login/route");
    expect((await POST(request({ username: user.username, password: prefix + "different suffix" }))).status).toBe(200);
    const session = await auth.getAuthSession(cookie.token);
    expect(session?.session.passwordReplacementRecommended).toBe(true);
    expect(await auth.verifySessionPassword(cookie.token, prefix + "another suffix")).toHaveProperty("auth");
    const { GET } = await import("@/app/api/auth/me/route");
    const me = await GET();
    expect(me.headers.get("cache-control")).toContain("no-store");
    expect(await me.json()).toMatchObject({ passwordReplacementRecommended: true });
    expect(auth.getUserById(user.id)?.passwordHash).toBe(user.passwordHash);
  });

  it("retains the hint server-side and exposes it only after successful TOTP", async () => {
    const auth = await import("@/auth");
    const prefix = "😀".repeat(18);
    const user = await auth.createUser("legacy-totp", await bcrypt.hash(prefix + "original suffix", 10));
    const secret = auth.generateTotpSecret();
    auth.setTotpSecret(user.id, secret);
    const { POST: login } = await import("@/app/api/auth/login/route");
    const response = await login(request({ username: user.username, password: prefix + "different suffix" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["challengeToken", "requiresTotp"]);
    expect(decodeJwt(body.challengeToken)).not.toHaveProperty("passwordReplacementRecommended");
    expect(auth.listSessions(user.id)).toEqual([]);
    const { GET } = await import("@/app/api/auth/me/route");
    expect((await GET()).status).toBe(401);
    const { POST: complete } = await import("@/app/api/auth/totp/verify/route");
    const code = generateSync({ secret });
    const wrong = (code[0] === "0" ? "1" : "0") + code.slice(1);
    const failed = await complete(request({ challengeToken: body.challengeToken, code: wrong }));
    expect(failed.status).toBe(401);
    expect(await failed.json()).not.toHaveProperty("passwordReplacementRecommended");
    expect((await GET()).status).toBe(401);
    expect(cookie.set).not.toHaveBeenCalled();
    expect((await complete(request({ challengeToken: body.challengeToken, code }))).status).toBe(200);
    expect(await (await GET()).json()).toMatchObject({ passwordReplacementRecommended: true });
  });

  it("allows the authenticated recommendation to reach recovery while preserving the ordinary-session redirect", async () => {
    const auth = await import("@/auth");
    const prefix = "p".repeat(72);
    const user = await auth.createUser("guided-reset", await bcrypt.hash(prefix + "legacy", 10));
    cookie.token = auth.createSession(user.id).token;
    const { default: page } = await import("@/app/reset-password/page");
    await expect(page()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    const { POST } = await import("@/app/api/auth/login/route");
    expect((await POST(request({ username: user.username, password: prefix + "candidate" }))).status).toBe(200);
    await expect(page()).resolves.not.toBeNull();
  });

  it("does not disclose byte guidance on a failed long-password login", async () => {
    const auth = await import("@/auth");
    await auth.createUser("ordinary", await auth.hashPassword("ordinary password"));
    const { POST } = await import("@/app/api/auth/login/route");
    const failed = await POST(request({ username: "ordinary", password: "z".repeat(100) }));
    expect(failed.status).toBe(401);
    expect(await failed.json()).toEqual({ error: "Invalid credentials" });
    expect(cookie.set).not.toHaveBeenCalled();
  });
});
