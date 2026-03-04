// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";

describe("user management", () => {
  beforeEach(() => vi.resetModules());

  it("createUser creates a user and returns it", async () => {
    const { createUser } = await import("../../auth/users");
    const user = await createUser("admin", "hash123");
    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(user.username).toBe("admin");
    expect(user.passwordHash).toBe("hash123");
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it("getUserByUsername returns the user when found", async () => {
    const { createUser, getUserByUsername } = await import("../../auth/users");
    await createUser("bob", "hashbob");
    const found = getUserByUsername("bob");
    expect(found?.username).toBe("bob");
  });

  it("getUserByUsername returns null when not found", async () => {
    const { getUserByUsername } = await import("../../auth/users");
    expect(getUserByUsername("nobody")).toBeNull();
  });

  it("getUserById returns user when found", async () => {
    const { createUser, getUserById } = await import("../../auth/users");
    const created = await createUser("alice", "hashalice");
    const found = getUserById(created.id);
    expect(found?.username).toBe("alice");
  });

  it("countUsers returns 0 on empty DB", async () => {
    const { countUsers } = await import("../../auth/users");
    expect(countUsers()).toBe(0);
  });

  it("countUsers returns correct count after inserts", async () => {
    const { createUser, countUsers } = await import("../../auth/users");
    await createUser("u1", "h1");
    await createUser("u2", "h2");
    expect(countUsers()).toBe(2);
  });

  it("createUser throws on duplicate username", async () => {
    const { createUser } = await import("../../auth/users");
    await createUser("dup", "h");
    await expect(createUser("dup", "h2")).rejects.toThrow();
  });
});
