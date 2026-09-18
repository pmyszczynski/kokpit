// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";
process.env.KOKPIT_SESSION_SECRET = "test-secret-32-chars-minimum-length-xx";

describe("persistent sessions", () => {
  beforeEach(() => vi.resetModules());

  it("returns null when token is undefined", async () => {
    const { getAuthUser } = await import("../../auth/session");
    expect(await getAuthUser(undefined)).toBeNull();
  });

  it("returns null for an invalid or legacy JWT token", async () => {
    const { getAuthUser } = await import("../../auth/session");
    expect(await getAuthUser("not-a-valid-jwt")).toBeNull();
    expect(await getAuthUser("eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1c2VyIn0.invalid")).toBeNull();
  });

  it("returns the user and session metadata for an opaque token", async () => {
    const { createUser } = await import("../../auth/users");
    const { getAuthUser, getAuthSession } = await import("../../auth/session");
    const { createSession } = await import("../../auth/sessionStore");

    const user = await createUser("testuser", "hash");
    const { token, session } = createSession(user.id, { userAgent: "Kokpit test", idleTimeoutHours: 12 });
    const result = await getAuthUser(token);
    expect(result?.username).toBe("testuser");
    expect((await getAuthSession(token))?.session).toMatchObject({
      id: session.id,
      userId: session.userId,
      device: session.device,
      idleTimeoutHours: session.idleTimeoutHours,
    });
  });

  it("stores only a hash of the opaque token", async () => {
    const { createUser } = await import("../../auth/users");
    const { createSession } = await import("../../auth/sessionStore");
    const { getDb } = await import("../../auth/db");
    const user = await createUser("hashed-token", "hash");
    const { token } = createSession(user.id, { userAgent: "Mozilla/5.0 Chrome/120.0 Mac OS X" });
    const row = getDb().prepare("SELECT token_hash, device FROM sessions WHERE user_id = ?").get(user.id) as {
      token_hash: string;
      device: string;
    };

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.device).toBe("Chrome on macOS");

    const androidSession = createSession(user.id, { userAgent: "Android" });
    expect(androidSession.session.device).toBe("Android");
  });

  it("revokes only the selected user session", async () => {
    const { createUser } = await import("../../auth/users");
    const { createSession, getAuthSession, revokeSession, listSessions } = await import("../../auth/sessionStore");
    const firstUser = await createUser("first", "hash");
    const secondUser = await createUser("second", "hash");
    const first = createSession(firstUser.id);
    const second = createSession(secondUser.id);

    revokeSession(secondUser.id, first.session.id);
    expect(await getAuthSession(first.token)).not.toBeNull();
    revokeSession(firstUser.id, first.session.id);
    expect(await getAuthSession(first.token)).toBeNull();
    expect(await getAuthSession(second.token)).not.toBeNull();
    expect(listSessions(firstUser.id)).toEqual([]);
  });

  it("rejects and removes an idle-expired session", async () => {
    const { createUser } = await import("../../auth/users");
    const { createSession, getAuthSession, listSessions } = await import("../../auth/sessionStore");
    const { getDb } = await import("../../auth/db");
    const user = await createUser("idle", "hash");
    const { token, session } = createSession(user.id, { idleTimeoutHours: 1 });
    getDb().prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(Date.now() - 60 * 60 * 1000, session.id);

    expect(await getAuthSession(token)).toBeNull();
    expect(listSessions(user.id)).toEqual([]);
  });

  it("persists each successful idle-session activity", async () => {
    vi.useFakeTimers();
    try {
      const { createUser } = await import("../../auth/users");
      const { createSession, getAuthSession } = await import("../../auth/sessionStore");
      const { getDb } = await import("../../auth/db");
      const user = await createUser("idle-activity", "hash");
      const { token, session } = createSession(user.id, { idleTimeoutHours: 1 });
      vi.setSystemTime(session.lastSeenAt + 1_000);

      await getAuthSession(token);
      const row = getDb().prepare("SELECT last_seen_at FROM sessions WHERE id = ?").get(session.id) as { last_seen_at: number };
      expect(row.last_seen_at).toBe(session.lastSeenAt + 1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists an opaque session across a database restart", async () => {
    const { mkdtempSync, rmSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const directory = mkdtempSync(join(tmpdir(), "kokpit-session-test-"));
    let closeReopenedDb: (() => void) | undefined;
    try {
      process.env.KOKPIT_DB_PATH = join(directory, "users.db");
      vi.resetModules();
      const { createUser } = await import("../../auth/users");
      const { createSession } = await import("../../auth/sessionStore");
      const { closeDb } = await import("../../auth/db");
      const user = await createUser("restart", "hash");
      const { token } = createSession(user.id);
      closeDb();
      vi.resetModules();
      const { getAuthSession } = await import("../../auth/sessionStore");
      ({ closeDb: closeReopenedDb } = await import("../../auth/db"));
      expect((await getAuthSession(token))?.user.username).toBe("restart");
    } finally {
      closeReopenedDb?.();
      process.env.KOKPIT_DB_PATH = ":memory:";
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
