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
    vi.resetAllMocks();
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

  it("preserves a custom override's exact bytes and precedence over the file", async () => {
    process.env.KOKPIT_SESSION_SECRET = "  custom-managed-key\n";
    const { getServerSecret } = await import("@/auth/serverSecret");

    expect(new TextDecoder().decode(getServerSecret())).toBe("  custom-managed-key\n");
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(getServerSecret()).toBe(getServerSecret());
  });

  it("rejects the shipped environment placeholder without reading or changing the persisted key", async () => {
    process.env.KOKPIT_SESSION_SECRET = "change-this-to-a-random-32-char-secret-before-use";
    const { getServerSecret } = await import("@/auth/serverSecret");

    expect(() => getServerSecret()).toThrow(/Remove the override.*generated persisted key/);
    expect(() => getServerSecret()).not.toThrow(process.env.KOKPIT_SESSION_SECRET);
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("rejects a persisted placeholder without replacing it", async () => {
    const placeholder = "change-this-to-a-random-32-char-secret-before-use";
    fs.readFileSync.mockReturnValue(`${placeholder}\n`);
    const { getServerSecret } = await import("@/auth/serverSecret");

    expect(() => getServerSecret()).toThrow(/persisted .session_secret.*deliberately replace/);
    try { getServerSecret(); } catch (error) {
      expect((error as Error).message).not.toContain(placeholder);
    }
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("rejects a placeholder written by a competing creator", async () => {
    fs.readFileSync
      .mockImplementationOnce(() => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); })
      .mockReturnValue("change-this-to-a-random-32-char-secret-before-use");
    fs.writeFileSync.mockImplementation(() => {
      throw Object.assign(new Error("already exists"), { code: "EEXIST" });
    });
    const { getServerSecret } = await import("@/auth/serverSecret");

    expect(() => getServerSecret()).toThrow(/persisted .session_secret.*deliberately replace/);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it("propagates file read failures without replacing the existing key", async () => {
    const failure = Object.assign(new Error("permission denied"), { code: "EACCES" });
    fs.readFileSync.mockImplementation(() => { throw failure; });
    const { getServerSecret } = await import("@/auth/serverSecret");

    expect(() => getServerSecret()).toThrow(failure);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("propagates creation failures other than a competing creator", async () => {
    fs.readFileSync.mockImplementation(() => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    const failure = Object.assign(new Error("read-only data volume"), { code: "EROFS" });
    fs.writeFileSync.mockImplementation(() => { throw failure; });
    const { getServerSecret } = await import("@/auth/serverSecret");

    expect(() => getServerSecret()).toThrow(failure);
  });
});
