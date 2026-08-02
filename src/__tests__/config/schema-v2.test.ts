import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { KokpitConfigSchema } from "@/config/schema";
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
});

describe("v1 migration", () => {
  it("creates independent stable references without deduplicating entries", () => {
    const migrated = migrateV1Config({
      schema_version: 1,
      services: [
        { name: "Sonarr", url: "https://sonarr.example", group: "Media", widget: { type: "sonarr-calendar", config: { url: "http://sonarr:8989", api_key: "secret", days: 7 } } },
        { name: "Sonarr", url: "https://sonarr.example", group: "Media", widget: { type: "sonarr-queue", config: { url: "http://sonarr:8989", api_key: "secret", limit: 5 } } },
      ],
    });
    expect(migrated.services).toHaveLength(2);
    expect(new Set(migrated.services.map((service) => service.id)).size).toBe(2);
    expect(migrated.service_tiles.map((tile) => tile.service_id)).toEqual(migrated.services.map((service) => service.id));
    expect(migrated.services[0].integration?.config).toEqual({ url: "http://sonarr:8989", api_key: "secret" });
    expect(migrated.service_tiles[0].widget?.config).toEqual({ days: 7 });
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
