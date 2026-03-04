// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";
process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";

// Mock getConfig so no real settings.yaml is needed
vi.mock("@/config", () => ({
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
});
