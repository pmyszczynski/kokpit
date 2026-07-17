// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";
process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";

describe("GET /api/setup", () => {
  beforeEach(() => vi.resetModules());

  it("returns setupRequired: true when no users exist", async () => {
    const { GET } = await import("../../app/api/setup/route");
    const res = await GET(new Request("http://localhost/api/setup"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.setupRequired).toBe(true);
  });
});

describe("POST /api/setup", () => {
  beforeEach(() => vi.resetModules());

  it("creates first user and returns 201", async () => {
    const { POST } = await import("../../app/api/setup/route");
    const res = await POST(
      new Request("http://localhost/api/setup", {
        method: "POST",
        body: JSON.stringify({ username: "admin", password: "password123" }),
      })
    );
    expect(res.status).toBe(201);
  });

  it("returns a recovery code and stores only its hash", async () => {
    const { POST } = await import("../../app/api/setup/route");
    const res = await POST(
      new Request("http://localhost/api/setup", {
        method: "POST",
        body: JSON.stringify({ username: "reco-admin", password: "password123" }),
      })
    );
    const json = await res.json();
    expect(typeof json.recoveryCode).toBe("string");
    expect(json.recoveryCode).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{8}){3}$/);

    const { getUserByUsername, verifyRecoveryCode } = await import("@/auth");
    const user = getUserByUsername("reco-admin");
    expect(user?.recoveryCodeHash).toBeTruthy();
    expect(user!.recoveryCodeHash).not.toBe(json.recoveryCode);
    expect(verifyRecoveryCode(json.recoveryCode, user!.recoveryCodeHash!)).toBe(true);
  });

  it("returns 409 if users already exist", async () => {
    const { POST } = await import("../../app/api/setup/route");
    await POST(
      new Request("http://localhost/api/setup", {
        method: "POST",
        body: JSON.stringify({ username: "admin", password: "password123" }),
      })
    );
    const res = await POST(
      new Request("http://localhost/api/setup", {
        method: "POST",
        body: JSON.stringify({ username: "admin2", password: "password456" }),
      })
    );
    expect(res.status).toBe(409);
  });

  it("only lets one of two concurrent setup requests with different usernames succeed", async () => {
    const { POST } = await import("../../app/api/setup/route");
    const [resA, resB] = await Promise.all([
      POST(
        new Request("http://localhost/api/setup", {
          method: "POST",
          body: JSON.stringify({ username: "race-a", password: "password123" }),
        })
      ),
      POST(
        new Request("http://localhost/api/setup", {
          method: "POST",
          body: JSON.stringify({ username: "race-b", password: "password456" }),
        })
      ),
    ]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const { countUsers } = await import("../../auth/users");
    expect(countUsers()).toBe(1);
  });

  it("returns 400 for missing password", async () => {
    const { POST } = await import("../../app/api/setup/route");
    const res = await POST(
      new Request("http://localhost/api/setup", {
        method: "POST",
        body: JSON.stringify({ username: "admin" }),
      })
    );
    expect(res.status).toBe(400);
  });
});
