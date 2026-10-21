// @vitest-environment node
import { mkdtempSync, rmSync } from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import { join } from "path";
import { spawn } from "node:child_process";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirectories: string[] = [];
const requireFromHere = createRequire(import.meta.url);
const initialDbPath = process.env.KOKPIT_DB_PATH;

afterEach(async () => {
  const { closeDb } = await import("@/auth");
  closeDb();
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  if (initialDbPath === undefined) delete process.env.KOKPIT_DB_PATH;
  else process.env.KOKPIT_DB_PATH = initialDbPath;
  vi.resetModules();
});

describe("reset-password script database initialization", () => {
  it("creates the application-compatible sessions schema before the app opens the database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kokpit-reset-password-"));
    tempDirectories.push(directory);
    process.env.KOKPIT_DB_PATH = join(directory, "users.db");

    const script = requireFromHere("../../../scripts/reset-password.js") as {
      openDb(): Database.Database;
    };
    const db = script.openDb();
    const columns = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[])
      .map((column) => column.name);
    const index = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get("sessions_user_id_idx");
    expect(columns).toEqual(expect.arrayContaining([
      "id", "user_id", "token_hash", "device", "created_at", "last_seen_at", "idle_timeout_hours",
    ]));
    expect(index).toBeDefined();
    db.close();

    const { createSession, createUser } = await import("@/auth");
    const user = await createUser("script-migration", "hash");
    expect(() => createSession(user.id)).not.toThrow();
  });
});

/** Drive the actual host utility through prompts without echoing fixture secrets. */
function interactiveReset(dbPath: string) {
  const child = spawn(process.execPath, [join(process.cwd(), "scripts/reset-password.js")], {
    env: { ...process.env, KOKPIT_DB_PATH: dbPath }, stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { output += chunk.toString(); });
  child.stdin.on("error", () => {});
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  const waitFor = (needle: string, offset = 0): Promise<number> => new Promise((resolve, reject) => {
    const inspect = () => {
      const index = output.indexOf(needle, offset);
      if (index < 0) return;
      cleanup();
      resolve(index);
    };
    const failed = () => { cleanup(); reject(new Error("Reset utility exited before its expected prompt")); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Reset utility prompt timed out")); }, 5000);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", inspect);
      child.stderr.off("data", inspect);
      child.off("exit", failed);
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("exit", failed);
    inspect();
  });
  return { child, waitFor, exited, output: () => output };
}

describe("reset-password byte policy", () => {
  it("reprompts on UTF-8 overflow without mutation, then resets only after valid input", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kokpit-reset-policy-"));
    tempDirectories.push(directory);
    const dbPath = join(directory, "users.db");
    process.env.KOKPIT_DB_PATH = dbPath;
    vi.resetModules();
    const auth = await import("@/auth");
    const user = await auth.createUser("cli-policy", await auth.hashPassword("old password"));
    const session = auth.createSession(user.id);
    const challenge = await auth.signTotpChallenge(user.id, user.sessionVersion);
    const reset = interactiveReset(dbPath);
    const overlong = "😀".repeat(19);
    try {
      await reset.waitFor("New password (");
      reset.child.stdin.write(overlong + "\n");
      const rejection = await reset.waitFor("New passwords must be at most 72 UTF-8 bytes.");
      await reset.waitFor("New password (", rejection);
      expect(auth.getUserById(user.id)).toEqual(user);
      expect(await auth.getAuthSession(session.token)).not.toBeNull();
      expect(await auth.verifyTotpChallenge(challenge)).not.toBeNull();

      const allowed = "n".repeat(72);
      reset.child.stdin.write(allowed + "\n");
      await reset.waitFor("Confirm new password:");
      reset.child.stdin.write(allowed + "\n");
      await reset.waitFor("Also disable 2FA");
      reset.child.stdin.write("n\n");
      await reset.waitFor("Also invalidate the saved recovery code?");
      reset.child.stdin.write("n\n");
      expect(await reset.exited).toBe(0);
      expect(await auth.verifyPassword(allowed, auth.getUserById(user.id)!.passwordHash)).toBe(true);
      expect(await auth.verifyPassword("old password", auth.getUserById(user.id)!.passwordHash)).toBe(false);
      expect(await auth.getAuthSession(session.token)).toBeNull();
      expect(await auth.verifyTotpChallenge(challenge)).toBeNull();
      expect(reset.output()).not.toContain(overlong);
      expect(reset.output()).not.toContain(allowed);
    } finally {
      if (reset.child.exitCode === null) reset.child.kill("SIGTERM");
      await reset.exited;
    }
  });

  it("does not change credentials or sessions when cancelled after rejecting an overlong input", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kokpit-reset-cancel-"));
    tempDirectories.push(directory);
    const dbPath = join(directory, "users.db");
    process.env.KOKPIT_DB_PATH = dbPath;
    vi.resetModules();
    const auth = await import("@/auth");
    const user = await auth.createUser("cli-cancel", await auth.hashPassword("old password"));
    const session = auth.createSession(user.id);
    const reset = interactiveReset(dbPath);
    try {
      await reset.waitFor("New password (");
      reset.child.stdin.write("x".repeat(73) + "\n");
      await reset.waitFor("New passwords must be at most 72 UTF-8 bytes.");
      reset.child.kill("SIGINT");
      await reset.exited;
      expect(auth.getUserById(user.id)).toEqual(user);
      expect(await auth.getAuthSession(session.token)).not.toBeNull();
    } finally {
      if (reset.child.exitCode === null && reset.child.signalCode === null) reset.child.kill("SIGTERM");
      await reset.exited;
    }
  });
});
