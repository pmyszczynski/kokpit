// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";
process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    set: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
  }),
}));
vi.mock("@/auth/requestGuard", () => ({ isTrustedMutation: vi.fn().mockReturnValue(true) }));

describe("POST /api/auth/logout", () => {
  beforeEach(() => vi.resetModules());

  it("returns 200 with { ok: true }", async () => {
    const { POST } = await import("../../app/api/auth/logout/route");
    const res = await POST(new Request("http://localhost", { method: "POST" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("deletes the session cookie", async () => {
    const mockDelete = vi.fn();
    const { cookies } = await import("next/headers");
    (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({
      set: vi.fn(),
      delete: mockDelete,
      get: vi.fn(),
    });

    const { POST } = await import("../../app/api/auth/logout/route");
    await POST(new Request("http://localhost", { method: "POST" }));
    expect(mockDelete).toHaveBeenCalledWith("session");
  });

  it("revokes the exact session so its token cannot be replayed", async () => {
    const { createSession, createUser, getAuthSession } = await import("@/auth");
    const user = await createUser("logout-replay", "hash");
    const token = createSession(user.id).token;
    const { cookies } = await import("next/headers");
    (cookies as ReturnType<typeof vi.fn>).mockResolvedValue({
      set: vi.fn(), delete: vi.fn(), get: vi.fn().mockReturnValue({ value: token }),
    });

    const { POST } = await import("../../app/api/auth/logout/route");
    expect((await POST(new Request("http://localhost", { method: "POST" }))).status).toBe(200);
    expect(await getAuthSession(token)).toBeNull();
  });
});
