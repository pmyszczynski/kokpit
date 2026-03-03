// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

process.env.KOKPIT_DB_PATH = ":memory:";

describe("getDb()", () => {
  it("creates the users table on first call", async () => {
    vi.resetModules();
    const { getDb } = await import("../../auth/db");
    const db = getDb();
    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
      )
      .get();
    expect(table).toBeTruthy();
  });

  it("returns the same instance on subsequent calls", async () => {
    vi.resetModules();
    const { getDb } = await import("../../auth/db");
    expect(getDb()).toBe(getDb());
  });
});
