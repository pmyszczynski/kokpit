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
