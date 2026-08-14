// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const fsHooks = vi.hoisted(() => ({
  beforeRename: undefined as ((oldPath: string | Buffer | URL, newPath: string | Buffer | URL) => void) | undefined,
  afterRename: undefined as ((oldPath: string | Buffer | URL, newPath: string | Buffer | URL) => void) | undefined,
  beforeLink: undefined as ((existingPath: string | Buffer | URL, newPath: string | Buffer | URL) => void) | undefined,
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      fsHooks.beforeRename?.(args[0], args[1]);
      actual.renameSync(...args);
      fsHooks.afterRename?.(args[0], args[1]);
    },
    linkSync: (...args: Parameters<typeof actual.linkSync>) => {
      fsHooks.beforeLink?.(args[0], args[1]);
      return actual.linkSync(...args);
    },
  };
});

let tempDir: string;
let configPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "kokpit-loader-"));
  configPath = path.join(tempDir, "settings.yaml");
  process.env.KOKPIT_CONFIG_PATH = configPath;
  vi.resetModules();
});

afterEach(() => {
  fsHooks.beforeRename = undefined;
  fsHooks.afterRename = undefined;
  fsHooks.beforeLink = undefined;
  delete process.env.KOKPIT_CONFIG_PATH;
  rmSync(tempDir, { recursive: true, force: true });
  vi.resetModules();
});

/** Re-imports the loader module fresh so it re-reads KOKPIT_CONFIG_PATH from env. */
async function freshLoader() {
  return import("@/config/loader");
}

describe("getConfigPath", () => {
  it("reflects KOKPIT_CONFIG_PATH set at module load time", async () => {
    const { getConfigPath } = await freshLoader();
    expect(getConfigPath()).toBe(configPath);
  });
});

describe("loadConfig", () => {
  it("creates a default settings.yaml file when none exists and returns a valid default config", async () => {
    expect(existsSync(configPath)).toBe(false);

    const { loadConfig } = await freshLoader();
    const config = loadConfig();

    expect(existsSync(configPath)).toBe(true);
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(config.schema_version).toBe(2);
    expect(config.auth.enabled).toBe(true);
    expect(config.auth.session_ttl_hours).toBe(24);
    expect(config.appearance.theme).toBe("dark");
    expect(config.layout).toEqual({});
    expect(config.services).toEqual([]);
  });

  it("recovers an interrupted install before considering first-run defaults", async () => {
    const displaced = `${configPath}.displaced`;
    const source = "schema_version: 2\nappearance:\n  theme: oled\nservices: []\nservice_tiles: []\n";
    writeFileSync(displaced, source, "utf-8");

    const { loadConfig } = await freshLoader();
    expect(loadConfig().appearance.theme).toBe("oled");
    expect(readFileSync(configPath, "utf-8")).toBe(source);
    expect(existsSync(displaced)).toBe(false);
  });

  it("throws a descriptive error listing zod issues for schema-invalid YAML", async () => {
    writeFileSync(
      configPath,
      "schema_version: 2\nappearance:\n  theme: purple\n",
      "utf-8"
    );

    const { loadConfig } = await freshLoader();
    expect(() => loadConfig()).toThrow(/^Invalid settings\.yaml/);
    expect(() => loadConfig()).toThrow(/appearance\.theme/);
  });
});

describe("getConfig / invalidateCache", () => {
  it("returns the cached value until invalidateCache() is called, then re-reads the file", async () => {
    const { loadConfig, getConfig, invalidateCache } = await freshLoader();

    const initial = loadConfig();
    expect(initial.appearance.theme).toBe("dark");

    // Mutate the file directly on disk, bypassing writeConfig().
    writeFileSync(
      configPath,
      `
schema_version: 2
auth:
  enabled: true
  session_ttl_hours: 24
appearance:
  theme: light
layout:
  columns: 4
  row_height: 120
services: []
`.trim(),
      "utf-8"
    );

    // Still stale: getConfig() must not re-read the file on its own.
    expect(getConfig().appearance.theme).toBe("dark");

    invalidateCache();

    // Now it should pick up the new file contents.
    expect(getConfig().appearance.theme).toBe("light");
  });
});

describe("writeConfig", () => {
  it("throws a restoration failure instead of reporting a revision mismatch", async () => {
    const { loadConfig, writeConfig } = await freshLoader();
    loadConfig();
    const displaced = `${configPath}.displaced`;
    fsHooks.afterRename = (oldPath, newPath) => {
      if (oldPath === configPath && newPath === displaced) {
        writeFileSync(displaced, "schema_version: 2\nappearance:\n  theme: oled\n", "utf-8");
      }
    };
    fsHooks.beforeLink = (existingPath, newPath) => {
      if (existingPath === displaced && newPath === configPath) {
        throw Object.assign(new Error("restore failed"), { code: "EPERM" });
      }
    };
    expect(() => writeConfig({ appearance: { theme: "light" } })).toThrow(/restore failed/);
  });

  it("throws a conflicting transaction preservation failure after an EEXIST collision", async () => {
    const { loadConfig, writeConfig } = await freshLoader();
    loadConfig();
    const displaced = `${configPath}.displaced`;
    fsHooks.afterRename = (oldPath, newPath) => {
      if (oldPath === configPath && newPath === displaced) {
        writeFileSync(displaced, "schema_version: 2\nappearance:\n  theme: oled\n", "utf-8");
      }
    };
    fsHooks.beforeLink = (existingPath, newPath) => {
      if (existingPath === displaced && newPath === configPath) {
        throw Object.assign(new Error("collision"), { code: "EEXIST" });
      }
    };
    fsHooks.beforeRename = (oldPath, newPath) => {
      if (oldPath === displaced && String(newPath).startsWith(`${displaced}.conflict-`)) {
        throw Object.assign(new Error("preserve failed"), { code: "EPERM" });
      }
    };

    expect(() => writeConfig({ appearance: { theme: "light" } })).toThrow(/preserve failed/);
  });

  it("does not mask an installation failure with a restoration failure", async () => {
    const { loadConfig, writeConfig } = await freshLoader();
    loadConfig();
    const displaced = `${configPath}.displaced`;
    fsHooks.beforeLink = (existingPath, newPath) => {
      if (existingPath === displaced && newPath === configPath) {
        throw Object.assign(new Error("restore failed"), { code: "EPERM" });
      }
      if (newPath === configPath) {
        throw Object.assign(new Error("install failed"), { code: "EIO" });
      }
    };
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(() => writeConfig({ appearance: { theme: "light" } })).toThrow(/install failed/);
      expect(consoleSpy).toHaveBeenCalledWith(
        "[kokpit] could not restore settings transaction:",
        expect.objectContaining({ code: "EPERM" })
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("preserves an existing file mode and creates restrictive files", async () => {
    writeFileSync(configPath, "schema_version: 2\nservices: []\nservice_tiles: []\n", "utf-8");
    chmodSync(configPath, 0o640);
    const { writeConfig } = await freshLoader();
    writeConfig({ appearance: { theme: "light" } });
    expect(statSync(configPath).mode & 0o777).toBe(0o640);
  });
  it("merges a partial update into the existing YAML on disk and invalidates the cache", async () => {
    const { loadConfig, getConfig, writeConfig } = await freshLoader();
    loadConfig();

    writeConfig({ appearance: { theme: "light" } });

    const onDisk = readFileSync(configPath, "utf-8");
    expect(onDisk).toContain("light");

    // invalidateCache() was triggered internally, so getConfig() re-reads and reflects the change.
    expect(getConfig().appearance.theme).toBe("light");
  });

  it("preserves other top-level keys not included in the update", async () => {
    const { loadConfig, writeConfig } = await freshLoader();
    loadConfig();

    writeConfig({ appearance: { theme: "oled" } });

    const onDisk = readFileSync(configPath, "utf-8");
    expect(onDisk).toContain("schema_version: 2");
    expect(onDisk).toContain("oled");
  });

  it("round-trips new top-level groups and bookmarks arrays through YAML", async () => {
    const { loadConfig, getConfig, writeConfig } = await freshLoader();
    loadConfig();

    const groups = [
      { name: "Media", collapsed: true, columns: 6 },
      { name: "Downloads" },
    ];
    const bookmarks = [
      {
        name: "Dev",
        accent: "#7aa2f7",
        style: "list" as const,
        placement: { group: "Media", size: "tall" as const },
        links: [
          { name: "GitHub", url: "https://github.com", icon: "sh-github" },
          {
            name: "Grafana docs",
            url: "https://grafana.com/docs",
            abbr: "GD",
            description: "Panels & alerting reference",
          },
        ],
      },
    ];

    writeConfig({ groups, bookmarks });

    // Arrays of maps must serialize as valid YAML that parses back losslessly.
    const reloaded = getConfig();
    expect(reloaded.groups).toEqual([
      { name: "Media", collapsed: true },
      { name: "Downloads" },
    ]);
    expect(reloaded.bookmarks).toEqual(bookmarks);
  });

  it("migrates service_tiles[].size while round-tripping layout.ungrouped", async () => {
    const { loadConfig, getConfig, writeConfig } = await freshLoader();
    loadConfig();

    writeConfig({
      layout: { columns: 4, row_height: 120, ungrouped: "first" },
      services: [{ id: "00000000-0000-4000-8000-000000000001", name: "Plex" }],
      service_tiles: [{
        id: "00000000-0000-4000-8000-000000000002",
        service_id: "00000000-0000-4000-8000-000000000001",
        size: "large",
      }],
    });

    const reloaded = getConfig();
    expect(reloaded.layout.ungrouped).toBe("first");
    expect(reloaded.service_tiles[0].size).toBeUndefined();
    expect(reloaded.service_tiles[0].footprint).toEqual({ columnSpan: 6, rowSpan: 4 });
  });

  it("rewrites a known widget's unsupported persisted footprint", async () => {
    const { z } = await import("zod");
    const { clearRegistry, registerWidget } = await import("@/widgets");
    registerWidget({
      id: "fixed-grid-supported-test",
      name: "Supported test",
      configSchema: z.object({}),
      fetchData: async () => ({}),
      component: () => null,
      supportedFootprints: [{ columnSpan: 6, rowSpan: 2 }],
    });
    writeFileSync(configPath, [
      "schema_version: 2",
      "services:",
      "  - id: 00000000-0000-4000-8000-000000000001",
      "    name: Test",
      "service_tiles:",
      "  - id: 00000000-0000-4000-8000-000000000002",
      "    service_id: 00000000-0000-4000-8000-000000000001",
      "    footprint: { columnSpan: 3, rowSpan: 1 }",
      "    widget: { type: fixed-grid-supported-test }",
      "",
    ].join("\n"), "utf-8");

    try {
      const { loadConfig } = await freshLoader();
      expect(loadConfig().service_tiles[0].footprint)
        .toEqual({ columnSpan: 6, rowSpan: 2 });
      expect(readFileSync(configPath, "utf-8"))
        .toContain("columnSpan: 6");
    } finally {
      clearRegistry();
    }
  });
});

describe("v1 migration", () => {
  it("migrates a legacy service to a v2 service and tile", async () => {
    writeFileSync(
      configPath,
      `
schema_version: 1
services:
  - name: Legacy Tile
    position: { col: 1, row: 1, width: 2, height: 1 }
  - name: Modern Tile
    size: wide
`.trim(),
      "utf-8"
    );

    const { loadConfig } = await freshLoader();
    const config = loadConfig();

    expect(config.schema_version).toBe(2);
    expect(config.services).toHaveLength(2);
    expect(config.service_tiles).toHaveLength(2);
    expect(config.services[0]).toMatchObject({ name: "Legacy Tile" });
    expect(config.service_tiles[0].group).toBeUndefined();
    expect(config.service_tiles[0].size).toBeUndefined();
    expect(config.service_tiles[0].footprint).toEqual({ columnSpan: 6, rowSpan: 2 });
    expect(readFileSync(configPath, "utf-8")).toContain("schema_version: 2");
    expect(readFileSync(`${configPath}.v1.bak`, "utf-8")).toContain("schema_version: 1");
  });
});

describe("unversioned settings detection", () => {
  it("migrates an unversioned legacy shape and preserves its exact source", async () => {
    const source = "services:\n  - name: Legacy\n    url: https://example.com\n    group: Media\n    size: wide\n";
    writeFileSync(configPath, source, "utf-8");

    const { loadConfig } = await freshLoader();
    const config = loadConfig();

    expect(config.schema_version).toBe(2);
    expect(config.services[0]).toMatchObject({ name: "Legacy", launch_url: "https://example.com", category: "Media" });
    expect(config.service_tiles[0]).toMatchObject({ group: "Media", footprint: { columnSpan: 6, rowSpan: 2 } });
    expect(config.service_tiles[0]).not.toHaveProperty("size");
    expect(readFileSync(`${configPath}.pre-v2.bak`, "utf-8")).toBe(source);
    expect(readFileSync(configPath, "utf-8")).toContain("schema_version: 2");
  });

  it("preserves legacy service and widget comments in their migrated fields", async () => {
    const source = [
      "services:",
      "  # Keep the operator's service note",
      "  - name: Legacy # Friendly display name",
      "    url: https://example.com # Browser destination",
      "    widget:",
      "      type: plex # Dashboard widget",
      "      config:",
      "        url: http://plex.test:32400 # Internal endpoint",
      "        token: secret # Rotate this credential",
      "",
    ].join("\n");
    writeFileSync(configPath, source, "utf-8");

    const { loadConfig } = await freshLoader();
    loadConfig();

    const rewritten = readFileSync(configPath, "utf-8");
    expect(rewritten).toContain("# Keep the operator's service note");
    expect(rewritten).toContain("name: Legacy # Friendly display name");
    expect(rewritten).toContain("launch_url: https://example.com # Browser destination");
    expect(rewritten).toContain("type: plex # Dashboard widget");
    expect(rewritten).toContain("url: http://plex.test:32400 # Internal endpoint");
    expect(rewritten).toContain("token: secret # Rotate this credential");
  });

  it("merges connection comments when legacy cards deduplicate to one service", async () => {
    const source = [
      "services:",
      "  - name: Plex",
      "    widget:",
      "      type: plex",
      "      config:",
      "        url: http://plex.test:32400",
      "        token: secret # Primary credential note",
      "  - name: Plex",
      "    widget:",
      "      type: plex",
      "      config:",
      "        url: http://plex.test:32400",
      "        token: secret # Secondary credential note",
      "",
    ].join("\n");
    writeFileSync(configPath, source, "utf-8");

    const { loadConfig } = await freshLoader();
    expect(loadConfig().services).toHaveLength(1);
    const rewritten = readFileSync(configPath, "utf-8");
    expect(rewritten).toContain("Primary credential note");
    expect(rewritten).toContain("Secondary credential note");
  });

  it("normalizes neutral unversioned settings as schema v2", async () => {
    const source = "auth:\n  enabled: false\nservices: []\n";
    writeFileSync(configPath, source, "utf-8");

    const { loadConfig } = await freshLoader();
    expect(loadConfig()).toMatchObject({ schema_version: 2, auth: { enabled: false } });
    expect(readFileSync(`${configPath}.pre-v2.bak`, "utf-8")).toBe(source);
    expect(readFileSync(configPath, "utf-8")).toContain("schema_version: 2");
  });

  it("normalizes an empty settings file as schema v2", async () => {
    writeFileSync(configPath, "", "utf-8");

    const { loadConfig } = await freshLoader();
    expect(loadConfig().schema_version).toBe(2);
    expect(readFileSync(`${configPath}.pre-v2.bak`, "utf-8")).toBe("");
  });

  it("normalizes an unversioned v2 service shape without migrating it", async () => {
    const source = "# keep this operator comment\nservices:\n  - id: 00000000-0000-4000-8000-000000000001\n    name: Existing service\nservice_tiles: []\n";
    writeFileSync(configPath, source, "utf-8");

    const { loadConfig } = await freshLoader();
    const config = loadConfig();
    expect(config.services).toEqual([{ id: "00000000-0000-4000-8000-000000000001", name: "Existing service" }]);
    expect(config.service_tiles).toEqual([]);
    expect(readFileSync(`${configPath}.pre-v2.bak`, "utf-8")).toBe(source);
    expect(readFileSync(configPath, "utf-8")).toContain("# keep this operator comment");
  });

  it("rejects ambiguous mixed shapes without writing or backing up the file", async () => {
    const source = "services:\n  - id: 00000000-0000-4000-8000-000000000001\n    name: Mixed\n    url: https://example.com\n";
    writeFileSync(configPath, source, "utf-8");

    const { loadConfig } = await freshLoader();
    expect(() => loadConfig()).toThrow(/Ambiguous mixed legacy and schema v2 service shapes/);
    expect(readFileSync(configPath, "utf-8")).toBe(source);
    expect(existsSync(`${configPath}.pre-v2.bak`)).toBe(false);
  });

  it("rejects legacy services mixed with top-level v2 tiles", async () => {
    const source = "services:\n  - name: Legacy\n    url: https://example.com\nservice_tiles: []\n";
    writeFileSync(configPath, source, "utf-8");

    const { loadConfig } = await freshLoader();
    expect(() => loadConfig()).toThrow(/Ambiguous mixed legacy and schema v2 service shapes/);
    expect(readFileSync(configPath, "utf-8")).toBe(source);
    expect(existsSync(`${configPath}.pre-v2.bak`)).toBe(false);
  });

  it("rejects legacy and v2 entries mixed across the services array", async () => {
    const source = "services:\n  - name: Legacy\n    group: Media\n  - id: 00000000-0000-4000-8000-000000000001\n    name: V2\n";
    writeFileSync(configPath, source, "utf-8");

    const { loadConfig } = await freshLoader();
    expect(() => loadConfig()).toThrow(/Ambiguous mixed legacy and schema v2 service shapes/);
    expect(readFileSync(configPath, "utf-8")).toBe(source);
  });

  it("rejects explicit unsupported schema versions", async () => {
    writeFileSync(configPath, "schema_version: 3\nservices: []\n", "utf-8");

    const { loadConfig } = await freshLoader();
    expect(() => loadConfig()).toThrow(/Unsupported version 3/);
  });

  it("rejects explicit versions that contradict the detected shape", async () => {
    writeFileSync(
      configPath,
      "schema_version: 1\nservices:\n  - id: 00000000-0000-4000-8000-000000000001\n    name: V2\n",
      "utf-8"
    );
    let loader = await freshLoader();
    expect(() => loader.loadConfig()).toThrow(/Version 1 contradicts the detected schema v2 shape/);

    vi.resetModules();
    writeFileSync(
      configPath,
      "schema_version: 2\nservices:\n  - name: Legacy\n    url: https://example.com\n",
      "utf-8"
    );
    loader = await freshLoader();
    expect(() => loader.loadConfig()).toThrow(/Version 2 contradicts the detected legacy shape/);
  });

  it("does not silently drop malformed known legacy fields", async () => {
    writeFileSync(configPath, "services:\n  - name: Broken\n    size: enormous\n", "utf-8");

    const { loadConfig } = await freshLoader();
    expect(() => loadConfig()).toThrow(/services\.0\.size/);
    expect(existsSync(`${configPath}.pre-v2.bak`)).toBe(false);
  });

  it("does not silently drop unknown legacy service fields", async () => {
    const source = "services:\n  - name: Extended\n    url: https://example.com\n    custom_target: keep-me\n";
    writeFileSync(configPath, source, "utf-8");

    const { loadConfig } = await freshLoader();
    expect(() => loadConfig()).toThrow(/services\.0\.custom_target: unsupported legacy field/);
    expect(readFileSync(configPath, "utf-8")).toBe(source);
    expect(existsSync(`${configPath}.pre-v2.bak`)).toBe(false);
  });

  it("rejects YAML parser errors before migration touches the file", async () => {
    const source = "services:\n  - name: First\nservices:\n  - name: Second\n";
    writeFileSync(configPath, source, "utf-8");

    const { loadConfig } = await freshLoader();
    expect(() => loadConfig()).toThrow(/^Invalid settings\.yaml/);
    expect(readFileSync(configPath, "utf-8")).toBe(source);
    expect(existsSync(`${configPath}.pre-v2.bak`)).toBe(false);
  });

  it("preserves shared-section extensions while migrating legacy services", async () => {
    const source = [
      "auth:",
      "  enabled: true",
      "  users:",
      "    - admin",
      "layout:",
      "  columns: 4",
      "  custom_breakpoint: 900",
      "groups:",
      "  - name: Media",
      "    custom_group_value: keep-group",
      "bookmarks:",
      "  - name: Docs",
      "    custom_bookmark_value: keep-bookmark",
      "    links: []",
      "services:",
      "  - name: Legacy",
      "    url: https://example.com",
      "",
    ].join("\n");
    writeFileSync(configPath, source, "utf-8");

    const { loadConfig } = await freshLoader();
    expect(loadConfig().services[0].name).toBe("Legacy");
    const rewritten = readFileSync(configPath, "utf-8");
    expect(rewritten).toContain("users:");
    expect(rewritten).toContain("custom_breakpoint: 900");
    expect(rewritten).toContain("custom_group_value: keep-group");
    expect(rewritten).toContain("custom_bookmark_value: keep-bookmark");
    expect(readFileSync(`${configPath}.pre-v2.bak`, "utf-8")).toBe(source);
  });

  it("is idempotent after the first structural migration", async () => {
    writeFileSync(configPath, "services:\n  - name: Legacy\n", "utf-8");

    const { loadConfig, invalidateCache } = await freshLoader();
    const first = loadConfig();
    const firstDisk = readFileSync(configPath, "utf-8");
    invalidateCache();
    const second = loadConfig();

    expect(second).toEqual(first);
    expect(readFileSync(configPath, "utf-8")).toBe(firstDisk);
  });
});
