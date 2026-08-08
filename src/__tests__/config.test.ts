import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => {
  const readFileSync = vi.fn();
  const writeFileSync = vi.fn();
  const existsSync = vi.fn().mockReturnValue(true);
  const mkdirSync = vi.fn();
  const renameSync = vi.fn();
  const statSync = vi.fn();
  const chmodSync = vi.fn();
  const linkSync = vi.fn();
  const unlinkSync = vi.fn();
  return {
    default: {
      readFileSync, writeFileSync, existsSync, linkSync, mkdirSync, renameSync, statSync, unlinkSync, chmodSync,
    },
    readFileSync,
    writeFileSync,
    existsSync,
    mkdirSync,
    renameSync,
    statSync,
    linkSync,
    unlinkSync,
    chmodSync,
  };
});

vi.mock("proper-lockfile", () => ({
  lockSync: vi.fn(() => () => undefined),
}));

import { readFileSync, writeFileSync } from "fs";
import { lockSync } from "proper-lockfile";
import {
  loadConfig,
  getConfig,
  writeConfig,
  invalidateCache,
} from "../config/loader";

const VALID_YAML = `
schema_version: 2
auth:
  enabled: false
  session_ttl_hours: 24
appearance:
  theme: dark
layout: {}
services: []
service_tiles: []
`.trim();

describe("loadConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCache();
    vi.mocked(readFileSync).mockReturnValue(VALID_YAML);
  });

  it("parses a valid settings.yaml", () => {
    const config = loadConfig();
    expect(config.schema_version).toBe(2);
    expect(config.auth.enabled).toBe(false);
    expect(config.auth.session_ttl_hours).toBe(24);
    expect(config.appearance.theme).toBe("dark");
    expect(config.layout.columns).toBe(4);
    expect(config.layout.row_height).toBe(120);
    expect(config.services).toEqual([]);
    expect(lockSync).toHaveBeenCalledTimes(1);
  });

  it("applies defaults when optional sections are missing", () => {
    vi.mocked(readFileSync).mockReturnValue("schema_version: 2");
    const config = loadConfig();
    expect(config.auth.enabled).toBe(true);
    expect(config.auth.session_ttl_hours).toBe(24);
    expect(config.appearance.theme).toBe("dark");
    expect(config.layout.columns).toBe(4);
    expect(config.layout.row_height).toBe(120);
    expect(config.services).toEqual([]);
  });

  it("throws a formatted error with field path for an invalid theme value", () => {
    vi.mocked(readFileSync).mockReturnValue(
      "schema_version: 2\nappearance:\n  theme: purple"
    );
    expect(() => loadConfig()).toThrow("appearance.theme");
  });

  it("throws a formatted error with field path for an invalid service URL", () => {
    vi.mocked(readFileSync).mockReturnValue(
      "schema_version: 2\nservices:\n  - id: 00000000-0000-4000-8000-000000000001\n    name: Test\n    launch_url: not-a-url"
    );
    expect(() => loadConfig()).toThrow("services");
  });

  it("error message begins with 'Invalid settings.yaml'", () => {
    vi.mocked(readFileSync).mockReturnValue(
      "schema_version: 2\nappearance:\n  theme: purple"
    );
    expect(() => loadConfig()).toThrow(/^Invalid settings\.yaml/);
  });

  it("bounds migration retries when the file keeps changing", () => {
    const first = "services:\n  - name: First\n";
    const second = "services:\n  - name: Second\n";
    vi.mocked(readFileSync).mockReset();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      vi.mocked(readFileSync).mockReturnValueOnce(first).mockReturnValueOnce(second);
    }

    expect(() => loadConfig()).toThrow(/settings changed repeatedly during migration/);
    expect(readFileSync).toHaveBeenCalledTimes(6);
  });
});

describe("getConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCache();
    vi.mocked(readFileSync).mockReturnValue(VALID_YAML);
  });

  it("caches the result — file is only read once across multiple calls", () => {
    loadConfig();
    getConfig();
    getConfig();
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });

  it("loads on first call if cache is empty", () => {
    getConfig();
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });

  it("re-reads after invalidateCache()", () => {
    loadConfig();
    invalidateCache();
    vi.clearAllMocks();
    vi.mocked(readFileSync).mockReturnValue(VALID_YAML);
    getConfig();
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });
});

describe("fixed layout config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCache();
  });

  it("has no persisted viewport overrides", () => {
    vi.mocked(readFileSync).mockReturnValue(VALID_YAML);
    const config = loadConfig();
    expect(config.layout.tablet).toBeUndefined();
    expect(config.layout.mobile).toBeUndefined();
  });
});

describe("writeConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCache();
    vi.mocked(readFileSync).mockReturnValue(VALID_YAML);
    vi.mocked(writeFileSync).mockImplementation(() => undefined);
  });

  it("writes updated values back to the file", () => {
    writeConfig({ appearance: { theme: "light" } });
    const written = vi.mocked(writeFileSync).mock.calls.find(
      ([target]) => typeof target === "string" && target.includes(".tmp-")
    )?.[1] as string;
    expect(written).toContain("light");
  });

  it("preserves YAML comments from the original file", () => {
    vi.mocked(readFileSync).mockReturnValue(
      "# Dashboard config\nschema_version: 2\nappearance:\n  theme: dark\n"
    );
    writeConfig({ appearance: { theme: "light" } });
    const written = vi.mocked(writeFileSync).mock.calls.find(
      ([target]) => typeof target === "string" && target.includes(".tmp-")
    )?.[1] as string;
    expect(written).toContain("# Dashboard config");
    expect(written).toContain("light");
  });

  it("invalidates cache so next getConfig() re-reads the file", () => {
    loadConfig();
    writeConfig({ appearance: { theme: "light" } });
    vi.clearAllMocks();
    vi.mocked(readFileSync).mockReturnValue(VALID_YAML);
    getConfig();
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });
});
