// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    set: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
  }),
}));

describe("POST /api/auth/logout", () => {
  beforeEach(() => vi.resetModules());

  it("returns 200 with { ok: true }", async () => {
    const { POST } = await import("../../app/api/auth/logout/route");
    const res = await POST();
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
    await POST();
    expect(mockDelete).toHaveBeenCalledWith("session");
  });
});
