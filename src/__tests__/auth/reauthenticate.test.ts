// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";

describe("verifySessionPassword", () => {
  beforeEach(() => vi.resetModules());

  it("accepts the current password only for an active session", async () => {
    const { createSession, createUser, hashPassword, verifySessionPassword } = await import("@/auth");
    const user = await createUser("reauth-user", await hashPassword("correct-password"));
    const token = createSession(user.id).token;

    const result = await verifySessionPassword(token, "correct-password");
    expect("auth" in result).toBe(true);
    if ("auth" in result) expect(result.auth.user.id).toBe(user.id);
  });

  it("denies password confirmation for an already revoked session", async () => {
    const { createSession, createUser, hashPassword, revokeToken, verifySessionPassword } = await import("@/auth");
    const user = await createUser("reauth-already-revoked", await hashPassword("correct-password"));
    const token = createSession(user.id).token;
    revokeToken(token);

    await expect(verifySessionPassword(token, "correct-password"))
      .resolves.toEqual({ error: "Unauthorized", status: 401 });
  });

  it("caps failed password attempts per session", async () => {
    const { createSession, createUser, hashPassword, verifySessionPassword } = await import("@/auth");
    const user = await createUser("reauth-limit", await hashPassword("correct-password"));
    const token = createSession(user.id).token;

    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await verifySessionPassword(token, "wrong-password");
      expect("auth" in result).toBe(false);
      if (!("auth" in result)) expect(result.status).toBe(401);
    }
    const limited = await verifySessionPassword(token, "correct-password");
    expect("auth" in limited).toBe(false);
    if (!("auth" in limited)) expect(limited.status).toBe(429);

    const otherSession = createSession(user.id).token;
    const otherResult = await verifySessionPassword(otherSession, "correct-password");
    expect("auth" in otherResult).toBe(true);
  });

  it("denies password confirmation after the session is revoked during bcrypt", async () => {
    let resolveVerification: ((value: boolean) => void) | undefined;
    const verification = new Promise<boolean>((resolve) => {
      resolveVerification = resolve;
    });
    const verifyPassword = vi.fn(() => verification);
    vi.doMock("@/auth/passwords", () => ({
      verifyPassword,
    }));

    try {
      const { createSession, createUser, revokeToken } = await import("@/auth");
      const { verifySessionPassword } = await import("@/auth/reauthenticate");
      const user = await createUser("reauth-revoked", "hash");
      const token = createSession(user.id).token;
      const result = verifySessionPassword(token, "correct-password");

      await vi.waitFor(() => expect(verifyPassword).toHaveBeenCalledOnce());
      revokeToken(token);
      resolveVerification!(true);

      await expect(result).resolves.toEqual({ error: "Unauthorized", status: 401 });
    } finally {
      resolveVerification?.(false);
      vi.doUnmock("@/auth/passwords");
    }
  });
});
