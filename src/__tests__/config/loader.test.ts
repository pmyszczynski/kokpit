// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
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
    expect(config.schema_version).toBe(1);
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
      "schema_version: 1\nappearance:\n  theme: purple\n",
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
schema_version: 1
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
    expect(onDisk).toContain("schema_version: 1");
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

  it("round-trips services[].size and layout.ungrouped", async () => {
    const { loadConfig, getConfig, writeConfig } = await freshLoader();
    loadConfig();

    writeConfig({
      layout: { columns: 4, row_height: 120, ungrouped: "first" },
      services: [{ name: "Plex", size: "large" }],
    });

    const reloaded = getConfig();
    expect(reloaded.layout.ungrouped).toBe("first");
    expect(reloaded.services[0].size).toBe("large");
  });
});

describe("deprecated position warning", () => {
  it("warns once per service with a position field, naming the service", async () => {
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

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { loadConfig, invalidateCache, getConfig } = await freshLoader();
      loadConfig();

      const positionWarnings = warn.mock.calls.filter((c) =>
        String(c[0]).includes("position")
      );
      expect(positionWarnings).toHaveLength(1);
      expect(String(positionWarnings[0][0])).toContain("Legacy Tile");

      // Re-loading must not repeat the warning for the same service.
      invalidateCache();
      getConfig();
      expect(
        warn.mock.calls.filter((c) => String(c[0]).includes("position"))
      ).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("does not warn when no service uses position", async () => {
    writeFileSync(
      configPath,
      'schema_version: 1\nservices:\n  - name: Plex\n    size: wide\n',
      "utf-8"
    );

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { loadConfig } = await freshLoader();
      loadConfig();
      expect(
        warn.mock.calls.filter((c) => String(c[0]).includes("position"))
      ).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });
});
