import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => {
  const readFileSync = vi.fn();
  const writeFileSync = vi.fn();
  const existsSync = vi.fn().mockReturnValue(true);
  const mkdirSync = vi.fn();
  return {
    default: { readFileSync, writeFileSync, existsSync, mkdirSync },
    readFileSync,
    writeFileSync,
    existsSync,
    mkdirSync,
  };
});

import { readFileSync, writeFileSync } from "fs";
import {
  loadConfig,
  getConfig,
  writeConfig,
  invalidateCache,
} from "../config/loader";

const VALID_YAML = `
schema_version: 1
auth:
  enabled: false
  session_ttl_hours: 24
appearance:
  theme: dark
layout:
  columns: 4
  row_height: 120
services: []
`.trim();

describe("loadConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCache();
    vi.mocked(readFileSync).mockReturnValue(VALID_YAML);
  });

  it("parses a valid settings.yaml", () => {
    const config = loadConfig();
    expect(config.schema_version).toBe(1);
    expect(config.auth.enabled).toBe(false);
    expect(config.auth.session_ttl_hours).toBe(24);
    expect(config.appearance.theme).toBe("dark");
    expect(config.layout.columns).toBe(4);
    expect(config.layout.row_height).toBe(120);
    expect(config.services).toEqual([]);
  });

  it("applies defaults when optional sections are missing", () => {
    vi.mocked(readFileSync).mockReturnValue("schema_version: 1");
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
      "schema_version: 1\nappearance:\n  theme: purple"
    );
    expect(() => loadConfig()).toThrow("appearance.theme");
  });

  it("throws a formatted error with field path for an invalid service URL", () => {
    vi.mocked(readFileSync).mockReturnValue(
      "schema_version: 1\nservices:\n  - name: Test\n    url: not-a-url"
    );
    expect(() => loadConfig()).toThrow("services");
  });

  it("error message begins with 'Invalid settings.yaml'", () => {
    vi.mocked(readFileSync).mockReturnValue(
      "schema_version: 1\nappearance:\n  theme: purple"
    );
    expect(() => loadConfig()).toThrow(/^Invalid settings\.yaml/);
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

describe("layout viewport config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCache();
  });

  it("parses tablet and mobile viewport overrides", () => {
    vi.mocked(readFileSync).mockReturnValue(`
schema_version: 1
layout:
  columns: 4
  row_height: 120
  tablet:
    columns: 2
    row_height: 100
  mobile:
    columns: 1
`.trim());
    const config = loadConfig();
    expect(config.layout.tablet?.columns).toBe(2);
    expect(config.layout.tablet?.row_height).toBe(100);
    expect(config.layout.mobile?.columns).toBe(1);
    expect(config.layout.mobile?.row_height).toBeUndefined();
  });

  it("tablet and mobile are undefined when not specified", () => {
    vi.mocked(readFileSync).mockReturnValue(VALID_YAML);
    const config = loadConfig();
    expect(config.layout.tablet).toBeUndefined();
    expect(config.layout.mobile).toBeUndefined();
  });

  it("allows partial tablet override (only columns, no row_height)", () => {
    vi.mocked(readFileSync).mockReturnValue(`
schema_version: 1
layout:
  columns: 4
  row_height: 120
  tablet:
    columns: 2
`.trim());
    const config = loadConfig();
    expect(config.layout.tablet?.columns).toBe(2);
    expect(config.layout.tablet?.row_height).toBeUndefined();
  });

  it("rejects non-positive columns in tablet override", () => {
    vi.mocked(readFileSync).mockReturnValue(`
schema_version: 1
layout:
  columns: 4
  row_height: 120
  tablet:
    columns: 0
`.trim());
    expect(() => loadConfig()).toThrow(/Invalid settings\.yaml/);
  });

  it("rejects non-positive row_height in mobile override", () => {
    vi.mocked(readFileSync).mockReturnValue(`
schema_version: 1
layout:
  columns: 4
  row_height: 120
  mobile:
    row_height: -10
`.trim());
    expect(() => loadConfig()).toThrow(/Invalid settings\.yaml/);
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
    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain("light");
  });

  it("preserves YAML comments from the original file", () => {
    vi.mocked(readFileSync).mockReturnValue(
      "# Dashboard config\nschema_version: 1\nappearance:\n  theme: dark\n"
    );
    writeConfig({ appearance: { theme: "light" } });
    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
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
