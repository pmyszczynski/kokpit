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
  });
});
