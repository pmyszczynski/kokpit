// @vitest-environment node
import { mkdtempSync, rmSync } from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import { join } from "path";
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
  it("creates a sessions table compatible with createSession", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kokpit-reset-password-"));
    tempDirectories.push(directory);
    process.env.KOKPIT_DB_PATH = join(directory, "users.db");

    const script = requireFromHere("../../../scripts/reset-password.js") as {
      openDb(): { close(): void };
    };
    const db = script.openDb();
    db.close();

    const { createSession, createUser } = await import("@/auth");
    const user = await createUser("script-migration", "hash");
    expect(() => createSession(user.id)).not.toThrow();
  });
});
