// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";
process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";

function setupRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-kokpit-request": "1", ...headers },
    body: JSON.stringify(body),
  });
}

const untrustedHeaders: Record<string, string>[] = [
  { "content-type": "text/plain" },
  { "content-type": "application/x-www-form-urlencoded" },
  { "content-type": "application/json", "sec-fetch-site": "cross-site", "x-kokpit-request": "1" },
  { "content-type": "application/json", "sec-fetch-site": "same-site", "x-kokpit-request": "1" },
];

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
    const res = await POST(setupRequest({ username: "admin", password: "password123" }, {
      "sec-fetch-site": "same-origin", "origin": "http://localhost",
    }));
    expect(res.status).toBe(201);
  });

  it.each(untrustedHeaders)("rejects untrusted setup requests before creating an account: %j", async (headers) => {
    const { POST } = await import("../../app/api/setup/route");
    const response = await POST(new Request("http://localhost/api/setup", {
      method: "POST", headers: { ...headers, origin: "https://attacker.example" },
      body: JSON.stringify({ username: "attacker", password: "known-password" }),
    }));
    expect(response.status).toBe(403);
    const { countUsers } = await import("../../auth/users");
    expect(countUsers()).toBe(0);
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"])(
    "rejects %s even when the custom mutation header is supplied",
    async (contentType) => {
      const { POST } = await import("../../app/api/setup/route");
      const response = await POST(setupRequest({ username: "admin", password: "password123" }, {
        "content-type": contentType,
      }));
      expect(response.status).toBe(415);
      const { countUsers } = await import("../../auth/users");
      expect(countUsers()).toBe(0);
    }
  );

  it("returns a recovery code and stores only its hash", async () => {
    const { POST } = await import("../../app/api/setup/route");
    const res = await POST(setupRequest({ username: "reco-admin", password: "password123" }));
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
    await POST(setupRequest({ username: "admin", password: "password123" }));
    const res = await POST(setupRequest({ username: "admin2", password: "password456" }));
    expect(res.status).toBe(409);
  });

  it("only lets one of two concurrent setup requests with different usernames succeed", async () => {
    const { POST } = await import("../../app/api/setup/route");
    const [resA, resB] = await Promise.all([
      POST(setupRequest({ username: "race-a", password: "password123" })),
      POST(setupRequest({ username: "race-b", password: "password456" })),
    ]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const { countUsers } = await import("../../auth/users");
    expect(countUsers()).toBe(1);
  });

  it("returns 400 for missing password", async () => {
    const { POST } = await import("../../app/api/setup/route");
    const res = await POST(setupRequest({ username: "admin" }));
    expect(res.status).toBe(400);
  });
});
