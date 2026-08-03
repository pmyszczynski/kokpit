// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { KokpitConfigSchema, widgetIntegrationRequirement } from "@/config/schema";
import { migrateV1Config } from "@/config/loader";
import { toClientSafeSettings, UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY } from "@/widgets/configSecrets";

describe("schema v2 service ownership", () => {
  it("accepts duplicate names, an unreferenced Service, and shared ServiceTiles", () => {
    const serviceId = randomUUID();
    const result = KokpitConfigSchema.safeParse({
      schema_version: 2,
      services: [
        { id: serviceId, name: "Sonarr", integration: { type: "sonarr", config: {} } },
        { id: randomUUID(), name: "Sonarr" },
      ],
      service_tiles: [
        { id: randomUUID(), service_id: serviceId, widget: { type: "sonarr-calendar" } },
        { id: randomUUID(), service_id: serviceId, widget: { type: "sonarr-queue" } },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects dangling references and incompatible integrations", () => {
    const serviceId = randomUUID();
    const dangling = KokpitConfigSchema.safeParse({ schema_version: 2, services: [], service_tiles: [{ id: randomUUID(), service_id: serviceId }] });
    expect(dangling.success).toBe(false);
    const incompatible = KokpitConfigSchema.safeParse({
      schema_version: 2,
      services: [{ id: serviceId, name: "Server", integration: { type: "radarr", config: {} } }],
      service_tiles: [{ id: randomUUID(), service_id: serviceId, widget: { type: "sonarr-calendar" } }],
    });
    expect(incompatible.success).toBe(false);
  });

  it("rejects duplicate Service and ServiceTile IDs with precise paths", () => {
    const serviceId = randomUUID();
    const duplicateServices = KokpitConfigSchema.safeParse({
      schema_version: 2,
      services: [{ id: serviceId, name: "A" }, { id: serviceId, name: "B" }],
      service_tiles: [],
    });
    expect(duplicateServices.success).toBe(false);
    if (!duplicateServices.success) expect(duplicateServices.error.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "custom", path: ["services", 1, "id"] })])
    );
    const tileId = randomUUID();
    const duplicateTiles = KokpitConfigSchema.safeParse({
      schema_version: 2,
      services: [{ id: serviceId, name: "A" }],
      service_tiles: [{ id: tileId, service_id: serviceId }, { id: tileId, service_id: serviceId }],
    });
    expect(duplicateTiles.success).toBe(false);
    if (!duplicateTiles.success) expect(duplicateTiles.error.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "custom", path: ["service_tiles", 1, "id"] })])
    );
  });
});

describe("v1 migration", () => {
  it("only deduplicates services with identical presentation and connection", () => {
    const base = { url: "http://sonarr:8989", api_key: "secret" };
    const matching = migrateV1Config({ schema_version: 1, services: [
      { name: "Sonarr", url: "https://one.example", icon: "one", description: "One", group: "Media", widget: { type: "sonarr-calendar", config: base } },
      { name: "Sonarr", url: "https://one.example", icon: "one", description: "One", group: "Media", widget: { type: "sonarr-queue", config: base } },
    ] });
    expect(matching.services).toHaveLength(1);
    for (const [field, value] of Object.entries({ name: "Other", url: "https://other.example", icon: "other", description: "Other", group: "Other" })) {
      const first = { name: "Sonarr", url: "https://one.example", icon: "one", description: "One", group: "Media", widget: { type: "sonarr-calendar", config: base } };
      const second = { ...first, [field]: value, widget: { type: "sonarr-queue", config: base } };
      expect(migrateV1Config({ schema_version: 1, services: [first, second] }).services).toHaveLength(2);
    }
  });

  it.each([["plex", "plex"], ["sabnzbd", "sabnzbd"], ["docker", "docker"], ["system-stats", null]])(
    "maps registered widget %s to %s", (widget, integration) => {
      expect(widgetIntegrationRequirement(widget)).toBe(integration);
    }
  );
  it("deduplicates matching backends while retaining separate tile options", () => {
    const migrated = migrateV1Config({
      schema_version: 1,
      services: [
        { name: "Sonarr", url: "https://sonarr.example", group: "Media", widget: { type: "sonarr-calendar", config: { url: "http://sonarr:8989", api_key: "secret", days: 7 } } },
        { name: "Sonarr", url: "https://sonarr.example", group: "Media", widget: { type: "sonarr-queue", config: { api_key: "secret", url: "http://sonarr:8989", limit: 5 } } },
      ],
    });
    expect(migrated.services).toHaveLength(1);
    expect(migrated.service_tiles).toHaveLength(2);
    expect(migrated.service_tiles.map((tile) => tile.service_id)).toEqual([migrated.services[0].id, migrated.services[0].id]);
    expect(migrated.services[0].integration?.config).toEqual({ url: "http://sonarr:8989", api_key: "secret" });
    expect(migrated.service_tiles[0].widget?.config).toEqual({ days: 7 });
    expect(migrated.service_tiles[1].widget?.config).toEqual({ limit: 5 });
  });

  it("keeps Tautulli display sections on each tile before widgets register", () => {
    const migrated = migrateV1Config({
      schema_version: 1,
      services: [
        { name: "Tautulli", widget: { type: "tautulli-activity", config: { url: "http://tautulli", api_key: "secret", sections: ["summary"] } } },
        { name: "Tautulli", widget: { type: "tautulli-activity", config: { url: "http://tautulli", api_key: "secret", sections: ["sessions"] } } },
      ],
    });

    expect(migrated.services).toHaveLength(1);
    expect(migrated.services[0].integration?.config).toEqual({
      url: "http://tautulli",
      api_key: "secret",
    });
    expect(migrated.service_tiles.map((tile) => tile.widget?.config)).toEqual([
      { sections: ["summary"] },
      { sections: ["sessions"] },
    ]);
  });

  it("keeps integration-free widget configuration on the tile", () => {
    const migrated = migrateV1Config({
      schema_version: 1,
      services: [{ name: "Host", widget: { type: "system-stats", config: { show_load: true } } }],
    });

    expect(migrated.services[0].integration).toBeUndefined();
    expect(migrated.service_tiles[0].widget).toEqual({ type: "system-stats", config: { show_load: true } });
  });

  it("keeps unknown widget configuration without creating integration metadata", () => {
    const migrated = migrateV1Config({
      schema_version: 1,
      services: [{ name: "Custom", widget: { type: "custom-widget", config: { token: "opaque", display: "compact" } } }],
    });

    expect(migrated.services[0].integration).toBeUndefined();
    expect(migrated.service_tiles[0].widget).toEqual({
      type: "custom-widget",
      config: { token: "opaque", display: "compact" },
    });
  });

  it("preserves the source mode for the migrated file and v1 backup", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kokpit-v1-mode-"));
    const configPath = path.join(dir, "settings.yaml");
    writeFileSync(configPath, "schema_version: 1\nservices: []\n", "utf-8");
    chmodSync(configPath, 0o640);
    const previousPath = process.env.KOKPIT_CONFIG_PATH;
    process.env.KOKPIT_CONFIG_PATH = configPath;
    try {
      vi.resetModules();
      const { loadConfig } = await import("@/config/loader");
      loadConfig();

      expect(statSync(configPath).mode & 0o777).toBe(0o640);
      expect(statSync(`${configPath}.v1.bak`).mode & 0o777).toBe(0o640);
      expect(readFileSync(`${configPath}.v1.bak`, "utf-8")).toBe("schema_version: 1\nservices: []\n");
    } finally {
      if (previousPath === undefined) delete process.env.KOKPIT_CONFIG_PATH;
      else process.env.KOKPIT_CONFIG_PATH = previousPath;
      rmSync(dir, { recursive: true, force: true });
      vi.resetModules();
    }
  });
});

describe("schema-v2 client boundary", () => {
  it("redacts integration credentials while retaining tile options", () => {
    const serviceId = randomUUID();
    const safe = toClientSafeSettings(KokpitConfigSchema.parse({
      schema_version: 2,
      services: [{
        id: serviceId,
        name: "Sonarr",
        integration: {
          type: "sonarr",
          config: { url: "http://sonarr:8989", api_key: "do-not-leak" },
        },
      }],
      service_tiles: [{
        id: randomUUID(),
        service_id: serviceId,
        widget: { type: "sonarr-calendar", config: { days: 7 } },
      }],
    }));
    expect(JSON.stringify(safe)).not.toContain("do-not-leak");
    expect(safe.service_tiles[0].widget?.config).toEqual({ days: 7 });
  });

  it("keeps unclaimed integration configuration fully opaque", () => {
    const serviceId = randomUUID();
    const safe = toClientSafeSettings(KokpitConfigSchema.parse({
      schema_version: 2,
      services: [{ id: serviceId, name: "Unknown", integration: { type: "custom", config: { token: "hidden" } } }],
      service_tiles: [],
    }));
    expect(JSON.stringify(safe)).not.toContain("hidden");
    expect(safe.services[0].integration?.config).toHaveProperty(UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY);
  });
});
