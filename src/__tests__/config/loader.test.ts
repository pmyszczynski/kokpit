// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

let tempDir: string;
let configPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "kokpit-loader-"));
  configPath = path.join(tempDir, "settings.yaml");
  process.env.KOKPIT_CONFIG_PATH = configPath;
  vi.resetModules();
});

afterEach(() => {
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
    expect(config.layout.columns).toBe(4);
    expect(config.layout.row_height).toBe(120);
    expect(config.services).toEqual([]);
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
    expect(reloaded.groups).toEqual(groups);
    expect(reloaded.bookmarks).toEqual(bookmarks);
  });

  it("round-trips service_tiles[].size and layout.ungrouped", async () => {
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
    expect(reloaded.service_tiles[0].size).toBe("large");
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
    expect(config.service_tiles[0].size).toBe("wide");
    expect(readFileSync(configPath, "utf-8")).toContain("schema_version: 2");
    expect(readFileSync(`${configPath}.v1.bak`, "utf-8")).toContain("schema_version: 1");
  });
});
