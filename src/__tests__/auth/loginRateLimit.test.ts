// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb } from "@/auth/db";
import { reserveLoginAttempt, releaseSuccessfulLoginAttempt } from "@/auth/loginRateLimit";

beforeEach(() => {
  vi.stubEnv("KOKPIT_DB_PATH", ":memory:");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
});

afterEach(() => {
  closeDb();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("login throttling", () => {
  it("limits an account, shares case variants, and leaves other accounts available", () => {
    for (let i = 0; i < 10; i++) expect(reserveLoginAttempt("Admin").allowed).toBe(true);
    expect(reserveLoginAttempt("admin")).toEqual({ allowed: false, retryAfterSeconds: 900 });
    expect(reserveLoginAttempt("another-account").allowed).toBe(true);
  });

  it("keeps the fixed account window when blocked requests keep arriving", () => {
    for (let i = 0; i < 10; i++) reserveLoginAttempt("admin");
    vi.setSystemTime(Date.now() + 899_500);
    expect(reserveLoginAttempt("admin")).toEqual({ allowed: false, retryAfterSeconds: 1 });
    vi.setSystemTime(Date.now() + 500);
    expect(reserveLoginAttempt("admin").allowed).toBe(true);
  });

  it("bounds username rotation and does not store new counters while globally blocked", () => {
    for (let i = 0; i < 100; i++) expect(reserveLoginAttempt(`unknown-${i}`).allowed).toBe(true);
    expect(reserveLoginAttempt("new-unknown")).toEqual({ allowed: false, retryAfterSeconds: 60 });
    const { count } = getDb().prepare("SELECT COUNT(*) AS count FROM login_rate_limits").get() as { count: number };
    expect(count).toBe(101);
    vi.setSystemTime(Date.now() + 60_000);
    expect(reserveLoginAttempt("new-unknown").allowed).toBe(true);
  });

  it("releases successful checks without erasing earlier failures or the shared budget", () => {
    for (let i = 0; i < 9; i++) reserveLoginAttempt("admin");
    for (let i = 0; i < 91; i++) {
      const decision = reserveLoginAttempt("admin");
      expect(decision.allowed).toBe(true);
      if (decision.allowed) releaseSuccessfulLoginAttempt(decision.attempt);
    }
    expect(reserveLoginAttempt("other")).toEqual({ allowed: false, retryAfterSeconds: 60 });
    vi.setSystemTime(Date.now() + 60_000);
    expect(reserveLoginAttempt("admin").allowed).toBe(true);
    expect(reserveLoginAttempt("admin")).toEqual({ allowed: false, retryAfterSeconds: 840 });
  });

  it("does not let a late success release a reservation in a new window", () => {
    const old = reserveLoginAttempt("admin");
    vi.setSystemTime(Date.now() + 900_000);
    for (let i = 0; i < 10; i++) reserveLoginAttempt("admin");
    if (old.allowed) releaseSuccessfulLoginAttempt(old.attempt);
    expect(reserveLoginAttempt("admin").allowed).toBe(false);
  });

  it("prunes expired account state and stores a digest instead of the username", () => {
    reserveLoginAttempt("private-username");
    const rows = getDb().prepare("SELECT key FROM login_rate_limits").all() as { key: string }[];
    expect(rows.some(row => row.key.includes("private-username"))).toBe(false);
    vi.setSystemTime(Date.now() + 900_000);
    reserveLoginAttempt("different-account");
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM login_rate_limits").get()).toEqual({ count: 2 });
  });

  it("preserves throttling when the database is closed and reopened", () => {
    const directory = mkdtempSync(join(tmpdir(), "kokpit-login-limit-"));
    try {
      vi.stubEnv("KOKPIT_DB_PATH", join(directory, "users.db"));
      for (let i = 0; i < 10; i++) reserveLoginAttempt("admin");
      closeDb();
      expect(reserveLoginAttempt("admin").allowed).toBe(false);
    } finally {
      closeDb();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
