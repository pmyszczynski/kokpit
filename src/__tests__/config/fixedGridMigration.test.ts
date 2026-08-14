import { describe, expect, it } from "vitest";
// Pure config transformation coverage; the suite inherits Vitest's global jsdom setup and renders no UI.
import { migrateFixedGridConfig } from "@/config/loader";

describe("fixed-grid config migration", () => {
  it("removes dynamic geometry and preserves service tile data", () => {
    const serviceId = "10000000-0000-4000-8000-000000000001";
    const tileId = "20000000-0000-4000-8000-000000000002";
    const migrated = migrateFixedGridConfig({
      schema_version: 2,
      layout: { columns: 7, row_height: 155, tablet: { columns: 2 }, ungrouped: "first" },
      groups: [{ name: "Media", columns: 11, collapsed: true }],
      services: [{ id: serviceId, name: "Plex", launch_url: "https://plex.local" }],
      service_tiles: [{ id: tileId, service_id: serviceId, group: "Media", size: "wide", widget: { type: "unknown", config: { view: "queue" } } }],
    });
    expect(migrated.service_tiles[0]).toMatchObject({ id: tileId, service_id: serviceId, group: "Media", footprint: { columnSpan: 6, rowSpan: 2 }, widget: { config: { view: "queue" } } });
    expect(migrated.service_tiles[0]).not.toHaveProperty("size");
    expect(migrated.groups).toEqual([{ name: "Media", collapsed: true }]);
    expect(migrated.layout).toEqual({ ungrouped: "first" });
  });

  it("normalizes malformed persisted spans instead of reviving fluid geometry", () => {
    const serviceId = "10000000-0000-4000-8000-000000000001";
    const migrated = migrateFixedGridConfig({
      schema_version: 2,
      services: [{ id: serviceId, name: "Plex" }],
      service_tiles: [{
        id: "20000000-0000-4000-8000-000000000002",
        service_id: serviceId,
        footprint: { columnSpan: 99.7, rowSpan: 0 },
      }],
    });
    expect(migrated.service_tiles[0].footprint).toEqual({ columnSpan: 15, rowSpan: 1 });
  });
  it.each([
    ["wide", { columnSpan: 6, rowSpan: 2 }],
    ["tall", { columnSpan: 3, rowSpan: 4 }],
    ["large", { columnSpan: 6, rowSpan: 4 }],
  ] as const)("preserves a plain tile's legacy %s footprint", (size, footprint) => {
    const serviceId = "10000000-0000-4000-8000-000000000001";
    const migrated = migrateFixedGridConfig({
      schema_version: 2,
      services: [{ id: serviceId, name: "Plain" }],
      service_tiles: [{
        id: "20000000-0000-4000-8000-000000000002",
        service_id: serviceId,
        size,
      }],
    });

    expect(migrated.service_tiles[0]).toMatchObject({ footprint });
    expect(migrated.service_tiles[0]).not.toHaveProperty("size");
  });

  it("materializes a built-in widget's preferred and minimum canvas", () => {
    const serviceId = "10000000-0000-4000-8000-000000000001";
    const migrated = migrateFixedGridConfig({
      schema_version: 2,
      services: [{ id: serviceId, name: "Sonarr", integration: { type: "sonarr", config: {} } }],
      service_tiles: [{
        id: "20000000-0000-4000-8000-000000000002",
        service_id: serviceId,
        widget: { type: "sonarr-queue" },
      }],
    });

    expect(migrated.service_tiles[0].footprint).toEqual({ columnSpan: 3, rowSpan: 4 });
  });

  it("allocates a second row to a described plain card", () => {
    const serviceId = "10000000-0000-4000-8000-000000000001";
    const migrated = migrateFixedGridConfig({
      schema_version: 2,
      services: [{ id: serviceId, name: "Plex", description: "Media server" }],
      service_tiles: [{
        id: "20000000-0000-4000-8000-000000000002",
        service_id: serviceId,
        footprint: { columnSpan: 3, rowSpan: 1 },
      }],
    });

    expect(migrated.service_tiles[0].footprint).toEqual({ columnSpan: 3, rowSpan: 2 });
  });
});
