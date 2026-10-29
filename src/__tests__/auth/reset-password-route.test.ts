// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";
process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";

vi.mock("@/auth/requestGuard", () => ({ isTrustedMutation: vi.fn().mockReturnValue(true) }));

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  function resetRequest(username: string, recoveryCode = "invalid") {
    return new Request("http://localhost/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ username, recoveryCode, newPassword: "newpassword123" }),
    });
  }

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

  it("revokes every existing session when the password is reset", async () => {
    const { user, recoveryCode } = await setupUserWithRecoveryCode("session-reset");
    const { createSession, getAuthSession } = await import("@/auth");
    const first = createSession(user.id).token;
    const second = createSession(user.id).token;
    const { POST } = await import("../../app/api/auth/reset-password/route");
    const res = await POST(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ username: "session-reset", recoveryCode, newPassword: "newpassword123" }),
    }));
    expect(res.status).toBe(200);
    expect(await getAuthSession(first)).toBeNull();
    expect(await getAuthSession(second)).toBeNull();
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
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(3500);
  });

  it("stops rotating long unknown usernames without retaining them or creating more counters", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { POST } = await import("../../app/api/auth/reset-password/route");
    const { getDb } = await import("@/auth/db");
    const privateName = "private-username-".repeat(750);
    for (let i = 0; i < 100; i++) expect((await POST(resetRequest(`${privateName}${i}`))).status).toBe(401);
    for (let i = 100; i < 110; i++) {
      const response = await POST(resetRequest(`${privateName}${i}`));
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("60");
    }
    const rows = getDb().prepare("SELECT key FROM login_rate_limits").all() as { key: string }[];
    expect(rows).toHaveLength(100);
    for (const row of rows) expect(row.key).toMatch(/^recovery:[a-f0-9]{64}$/);
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM login_request_times").get()).toEqual({ count: 100 });
  });

  it("keeps throttling after route reload and database reopen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const directory = mkdtempSync(join(tmpdir(), "kokpit-recovery-route-"));
    vi.stubEnv("KOKPIT_DB_PATH", join(directory, "users.db"));
    try {
      const { POST } = await import("../../app/api/auth/reset-password/route");
      const { closeDb } = await import("@/auth/db");
      for (let i = 0; i < 10; i++) expect((await POST(resetRequest("Admin"))).status).toBe(401);
      closeDb();
      vi.resetModules();
      const reloaded = await import("../../app/api/auth/reset-password/route");
      const response = await reloaded.POST(resetRequest("ADMIN"));
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("3600");
    } finally {
      const { closeDb } = await import("@/auth/db");
      closeDb();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not erase earlier recovery failures after a successful password reset", async () => {
    const { recoveryCode } = await setupUserWithRecoveryCode("failed-then-successful");
    const { POST } = await import("../../app/api/auth/reset-password/route");
    const { getDb } = await import("@/auth/db");
    for (let i = 0; i < 9; i++) expect((await POST(resetRequest("failed-then-successful"))).status).toBe(401);
    expect((await POST(resetRequest("failed-then-successful", recoveryCode))).status).toBe(200);
    expect(getDb().prepare("SELECT attempts FROM login_rate_limits").get()).toEqual({ attempts: 9 });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM login_request_times").get()).toEqual({ count: 10 });
    expect((await POST(resetRequest("failed-then-successful"))).status).toBe(401);
    expect((await POST(resetRequest("failed-then-successful"))).status).toBe(429);
  });
});
