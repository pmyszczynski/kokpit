// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";
const cookieGet = vi.fn();
const cookieDelete = vi.fn();
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: cookieGet, delete: cookieDelete })) }));

function request(body: unknown, headers: Record<string, string> = { "X-Kokpit-Request": "1" }) {
  return new Request("http://localhost/api/auth/sessions", { method: "POST", headers, body: JSON.stringify(body) });
}

async function setup() {
  const auth = await import("@/auth");
  const user = await auth.createUser("owner", await auth.hashPassword("correct-password"));
  const current = auth.createSession(user.id, { userAgent: "Mozilla/5.0 Chrome/100" });
  const other = auth.createSession(user.id, { userAgent: "Mozilla/5.0 Firefox/100" });
  const stranger = await auth.createUser("stranger", "unused");
  const unrelated = auth.createSession(stranger.id);
  cookieGet.mockReturnValue({ value: current.token });
  return { auth, current, other, unrelated };
}

describe("session management", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); cookieGet.mockReturnValue(undefined); });

  it("requires a real session even when dashboard authentication is disabled", async () => {
    const { GET, POST } = await import("../../app/api/auth/sessions/route");
    expect((await GET()).status).toBe(401);
    expect((await POST(request({ action: "revoke-all", password: "x" }))).status).toBe(401);
  });

  it("lists only this user's safe metadata and marks the current browser", async () => {
    const { current, other } = await setup();
    const { GET } = await import("../../app/api/auth/sessions/route");
    const response = await GET();
    const { sessions } = await response.json();
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s: { id: string }) => s.id === current.session.id).current).toBe(true);
    expect(sessions.find((s: { id: string }) => s.id === other.session.id).current).toBe(false);
    expect(Object.keys(sessions[0]).sort()).toEqual(["createdAt", "current", "device", "id", "lastSeenAt"]);
    expect(JSON.stringify(sessions)).not.toContain(current.token);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects missing custom headers and cross-site or same-site browser requests", async () => {
    const { current, auth } = await setup();
    const { POST } = await import("../../app/api/auth/sessions/route");
    for (const headers of [{} as Record<string, string>, { "X-Kokpit-Request": "1", "Sec-Fetch-Site": "cross-site" }, { "X-Kokpit-Request": "1", "Sec-Fetch-Site": "same-site" }]) {
      expect((await POST(request({ action: "revoke", sessionId: current.session.id }, headers))).status).toBe(403);
    }
    expect(await auth.getAuthUser(current.token)).not.toBeNull();
  });

  it("revokes just the current session without a password and clears its cookie", async () => {
    const { current, other, auth } = await setup();
    const { POST } = await import("../../app/api/auth/sessions/route");
    expect((await POST(request({ action: "revoke", sessionId: current.session.id }))).status).toBe(200);
    expect(cookieDelete).toHaveBeenCalledWith("session");
    expect(await auth.getAuthUser(current.token)).toBeNull();
    expect(await auth.getAuthUser(other.token)).not.toBeNull();
  });

  it("requires password proof to revoke another browser", async () => {
    const { other, auth } = await setup();
    const { POST } = await import("../../app/api/auth/sessions/route");
    expect((await POST(request({ action: "revoke", sessionId: other.session.id }))).status).toBe(400);
    expect((await POST(request({ action: "revoke", sessionId: other.session.id, password: "wrong" }))).status).toBe(401);
    expect(await auth.getAuthUser(other.token)).not.toBeNull();
    expect((await POST(request({ action: "revoke", sessionId: other.session.id, password: "correct-password" }))).status).toBe(200);
    expect(await auth.getAuthUser(other.token)).toBeNull();
  });

  it("cannot revoke another user's browser even with valid password proof", async () => {
    const { unrelated, auth } = await setup();
    const { POST } = await import("../../app/api/auth/sessions/route");
    await POST(request({ action: "revoke", sessionId: unrelated.session.id, password: "correct-password" }));
    expect(await auth.getAuthUser(unrelated.token)).not.toBeNull();
  });

  it.each(["revoke-others", "revoke-all"])("%s respects current browser and account boundaries", async (action) => {
    const { current, other, unrelated, auth } = await setup();
    const { POST } = await import("../../app/api/auth/sessions/route");
    expect((await POST(request({ action, password: "correct-password" }))).status).toBe(200);
    expect(await auth.getAuthUser(other.token)).toBeNull();
    expect(Boolean(await auth.getAuthUser(current.token))).toBe(action === "revoke-others");
    expect(await auth.getAuthUser(unrelated.token)).not.toBeNull();
    expect(cookieDelete.mock.calls.length).toBe(action === "revoke-all" ? 1 : 0);
  });

  it("rejects malformed action bodies without mutations", async () => {
    const { current, auth } = await setup();
    const { POST } = await import("../../app/api/auth/sessions/route");
    for (const body of [null, {}, { action: "revoke", sessionId: "not-an-id" }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(await auth.getAuthUser(current.token)).not.toBeNull();
  });
});
