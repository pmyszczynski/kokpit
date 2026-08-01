// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("fs", () => ({ ...fs }));

describe("getServerSecret", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.KOKPIT_SESSION_SECRET;
    process.env.KOKPIT_DB_PATH = "data/users.db";
  });

  afterEach(() => {
    delete process.env.KOKPIT_SESSION_SECRET;
    delete process.env.KOKPIT_DB_PATH;
  });

  it("uses an exclusive write and reads the secret written by a competing process", async () => {
    fs.readFileSync
      .mockImplementationOnce(() => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      })
      .mockReturnValue("winner-secret\n");
    fs.writeFileSync.mockImplementation(() => {
      throw Object.assign(new Error("already exists"), { code: "EEXIST" });
    });

    const { getServerSecret } = await import("@/auth/serverSecret");

    expect(new TextDecoder().decode(getServerSecret())).toBe("winner-secret");
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "data/.session_secret",
      expect.any(String),
      expect.objectContaining({ flag: "wx", mode: 0o600 })
    );
  });

  it("rejects whitespace-only persisted and environment secrets", async () => {
    fs.readFileSync.mockReturnValue(" \n\t");
    const { getServerSecret } = await import("@/auth/serverSecret");
    expect(() => getServerSecret()).toThrow(/must not be empty/i);

    vi.resetModules();
    process.env.KOKPIT_SESSION_SECRET = "  ";
    const { getServerSecret: getEnvSecret } = await import("@/auth/serverSecret");
    expect(() => getEnvSecret()).toThrow(/must not be empty/i);
  });
});
