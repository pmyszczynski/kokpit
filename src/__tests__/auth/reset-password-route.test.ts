// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";
process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => vi.resetModules());

  async function setupUserWithRecoveryCode(username: string) {
    const { createUser, hashPassword, generateRecoveryCode, hashRecoveryCode, setRecoveryCodeHash } =
      await import("@/auth");
    const hash = await hashPassword("oldpassword");
    const user = await createUser(username, hash);
    const recoveryCode = generateRecoveryCode();
    setRecoveryCodeHash(user.id, hashRecoveryCode(recoveryCode));
    return { user, recoveryCode };
  }

  it("resets the password with a valid recovery code", async () => {
    const { user, recoveryCode } = await setupUserWithRecoveryCode("alice");

    const { POST } = await import("../../app/api/auth/reset-password/route");
    const res = await POST(
      new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          username: "alice",
          recoveryCode,
          newPassword: "newpassword123",
        }),
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.totpStillEnabled).toBe(false);

    const { getUserById, verifyPassword } = await import("@/auth");
    const updated = getUserById(user.id);
    expect(await verifyPassword("newpassword123", updated!.passwordHash)).toBe(true);
  });

  it("invalidates the recovery code after a successful reset (single-use)", async () => {
    const { recoveryCode } = await setupUserWithRecoveryCode("bob");

    const { POST } = await import("../../app/api/auth/reset-password/route");
    await POST(
      new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ username: "bob", recoveryCode, newPassword: "firstreset1" }),
      })
    );

    const res = await POST(
      new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ username: "bob", recoveryCode, newPassword: "secondreset1" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("reports totpStillEnabled: true and does not clear TOTP", async () => {
    const { user, recoveryCode } = await setupUserWithRecoveryCode("carol");
    const { generateTotpSecret, setTotpSecret, getUserById } = await import("@/auth");
    const secret = generateTotpSecret();
    setTotpSecret(user.id, secret);

    const { POST } = await import("../../app/api/auth/reset-password/route");
    const res = await POST(
      new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ username: "carol", recoveryCode, newPassword: "newpassword123" }),
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.totpStillEnabled).toBe(true);

    const updated = getUserById(user.id);
    expect(updated!.totpSecret).toBe(secret);
  });

  it("returns 401 on a wrong recovery code", async () => {
    const { generateRecoveryCode } = await import("@/auth");
    await setupUserWithRecoveryCode("dave");

    const { POST } = await import("../../app/api/auth/reset-password/route");
    const res = await POST(
      new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          username: "dave",
          recoveryCode: generateRecoveryCode(),
          newPassword: "newpassword123",
        }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 for an unknown username", async () => {
    const { POST } = await import("../../app/api/auth/reset-password/route");
    const res = await POST(
      new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({
          username: "nobody",
          recoveryCode: "aaaaaaaa-bbbbbbbb-cccccccc-dddddddd",
          newPassword: "newpassword123",
        }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when newPassword is too short", async () => {
    const { recoveryCode } = await setupUserWithRecoveryCode("erin");

    const { POST } = await import("../../app/api/auth/reset-password/route");
    const res = await POST(
      new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ username: "erin", recoveryCode, newPassword: "short" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 on missing fields", async () => {
    const { POST } = await import("../../app/api/auth/reset-password/route");
    const res = await POST(
      new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ username: "erin" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid JSON", async () => {
    const { POST } = await import("../../app/api/auth/reset-password/route");
    const res = await POST(
      new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        body: "not-json",
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when the JSON body is null", async () => {
    const { POST } = await import("../../app/api/auth/reset-password/route");
    const res = await POST(
      new Request("http://localhost/api/auth/reset-password", {
        method: "POST",
        body: "null",
      })
    );
    expect(res.status).toBe(400);
  });

  it("rate-limits repeated failed attempts for the same username", async () => {
    const { generateRecoveryCode } = await import("@/auth");
    await setupUserWithRecoveryCode("frank");

    const { POST } = await import("../../app/api/auth/reset-password/route");
    const makeRequest = () =>
      POST(
        new Request("http://localhost/api/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({
            username: "frank",
            recoveryCode: generateRecoveryCode(),
            newPassword: "newpassword123",
          }),
        })
      );

    for (let i = 0; i < 10; i++) {
      const res = await makeRequest();
      expect(res.status).toBe(401);
    }
    const res = await makeRequest();
    expect(res.status).toBe(429);
  });
});
