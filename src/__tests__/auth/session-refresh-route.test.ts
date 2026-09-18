// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";
const cookieGet = vi.fn();
const cookieSet = vi.fn();
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: cookieGet, set: cookieSet })) }));
vi.mock("@/config/server", () => ({ getConfig: () => ({ auth: { enabled: true } }) }));
const request = (headers = { "X-Kokpit-Request": "1" }) => new Request("http://localhost/api/auth/session/refresh", { method: "POST", headers });

describe("session cookie renewal", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); cookieGet.mockReturnValue(undefined); });

  it("renews a live opaque token without creating another session", async () => {
    const auth = await import("@/auth");
    const user = await auth.createUser("owner", "unused");
    const current = auth.createSession(user.id);
    cookieGet.mockReturnValue({ value: current.token });
    const { POST } = await import("../../app/api/auth/session/refresh/route");
    expect((await POST(request())).status).toBe(200);
    expect(cookieSet).toHaveBeenCalledWith("session", current.token, expect.objectContaining({ httpOnly: true, sameSite: "lax", maxAge: 365 * 86400 }));
    expect(auth.listSessions(user.id)).toHaveLength(1);
  });

  it("never restores a revoked session or accepts its replayed cookie", async () => {
    const auth = await import("@/auth");
    const user = await auth.createUser("owner", "unused");
    const current = auth.createSession(user.id);
    auth.revokeToken(current.token);
    cookieGet.mockReturnValue({ value: current.token });
    const { POST } = await import("../../app/api/auth/session/refresh/route");
    expect((await POST(request())).status).toBe(401);
    expect(cookieSet).not.toHaveBeenCalled();
    expect(auth.listSessions(user.id)).toEqual([]);
  });

  it("rejects missing sessions and untrusted requests", async () => {
    const { POST } = await import("../../app/api/auth/session/refresh/route");
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request({ "X-Kokpit-Request": "" }))).status).toBe(403);
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
