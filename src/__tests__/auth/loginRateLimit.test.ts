// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb } from "@/auth/db";
import { reserveLoginAttempt, reserveRecoveryAttempt, releaseSuccessfulLoginAttempt } from "@/auth/loginRateLimit";

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
    expect(count).toBe(100);
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM login_request_times").get()).toEqual({ count: 100 });
    vi.setSystemTime(Date.now() + 60_000);
    expect(reserveLoginAttempt("new-unknown").allowed).toBe(true);
  });

  it("does not admit a second burst at a minute boundary", () => {
    reserveLoginAttempt("warmup");
    vi.setSystemTime(Date.now() + 59_999);
    for (let i = 0; i < 99; i++) expect(reserveLoginAttempt(`burst-${i}`).allowed).toBe(true);
    vi.setSystemTime(Date.now() + 1);
    expect(reserveLoginAttempt("next-minute").allowed).toBe(true);
    expect(reserveLoginAttempt("another-next-minute")).toEqual({ allowed: false, retryAfterSeconds: 60 });
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
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM login_rate_limits").get()).toEqual({ count: 1 });
  });

  it("preserves throttling when the database is closed and reopened", () => {
    const directory = mkdtempSync(join(tmpdir(), "kokpit-login-limit-"));
    try {
      vi.stubEnv("KOKPIT_DB_PATH", join(directory, "users.db"));
      for (let i = 0; i < 10; i++) reserveLoginAttempt("admin");
      for (let i = 0; i < 90; i++) reserveLoginAttempt(`other-${i}`);
      closeDb();
      expect(reserveLoginAttempt("admin").allowed).toBe(false);
      expect(reserveLoginAttempt("new-account")).toEqual({ allowed: false, retryAfterSeconds: 60 });
    } finally {
      closeDb();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("recovery throttling", () => {
  it("shares case variants and keeps the ten-attempt account limit for one hour", () => {
    for (let i = 0; i < 10; i++) expect(reserveRecoveryAttempt("Admin").allowed).toBe(true);
    expect(reserveRecoveryAttempt("admin")).toEqual({ allowed: false, retryAfterSeconds: 3600 });
    vi.setSystemTime(Date.now() + 15 * 60_000);
    expect(reserveRecoveryAttempt("ADMIN")).toEqual({ allowed: false, retryAfterSeconds: 2700 });
    vi.setSystemTime(Date.now() + 45 * 60_000);
    expect(reserveRecoveryAttempt("admin").allowed).toBe(true);
  });

  it("bounds recovery username rotation with the shared login budget and stores only digests", () => {
    for (let i = 0; i < 50; i++) expect(reserveLoginAttempt(`login-${i}`).allowed).toBe(true);
    const privateName = "private-recovery-name-".repeat(500);
    for (let i = 0; i < 50; i++) expect(reserveRecoveryAttempt(`${privateName}${i}`).allowed).toBe(true);
    for (let i = 0; i < 100; i++) {
      expect(reserveRecoveryAttempt(`new-unknown-${i}`)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    }
    const rows = getDb().prepare("SELECT key FROM login_rate_limits").all() as { key: string }[];
    expect(rows).toHaveLength(100);
    const recoveryRows = rows.filter(row => row.key.startsWith("recovery:"));
    expect(recoveryRows).toHaveLength(50);
    for (const row of recoveryRows) expect(row.key).toMatch(/^recovery:[a-f0-9]{64}$/);
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM login_request_times").get()).toEqual({ count: 100 });
    vi.setSystemTime(Date.now() + 60_000);
    expect(reserveRecoveryAttempt("new-unknown").allowed).toBe(true);
  });

  it("preserves recovery failures when a successful request releases its own reservation", () => {
    for (let i = 0; i < 9; i++) reserveRecoveryAttempt("admin");
    const success = reserveRecoveryAttempt("admin");
    expect(success.allowed).toBe(true);
    if (success.allowed) releaseSuccessfulLoginAttempt(success.attempt);
    expect(getDb().prepare("SELECT attempts FROM login_rate_limits").get()).toEqual({ attempts: 9 });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM login_request_times").get()).toEqual({ count: 10 });
    expect(reserveRecoveryAttempt("admin").allowed).toBe(true);
    expect(reserveRecoveryAttempt("admin").allowed).toBe(false);
  });

  it("preserves recovery and shared throttling after the database is reopened", () => {
    const directory = mkdtempSync(join(tmpdir(), "kokpit-recovery-limit-"));
    try {
      vi.stubEnv("KOKPIT_DB_PATH", join(directory, "users.db"));
      for (let i = 0; i < 10; i++) reserveRecoveryAttempt("admin");
      for (let i = 0; i < 90; i++) reserveRecoveryAttempt(`other-${i}`);
      closeDb();
      expect(reserveRecoveryAttempt("ADMIN")).toEqual({ allowed: false, retryAfterSeconds: 3600 });
      expect(reserveRecoveryAttempt("new-account")).toEqual({ allowed: false, retryAfterSeconds: 60 });
    } finally {
      closeDb();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
