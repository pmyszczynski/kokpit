import { describe, expect, it } from "vitest";
// Pure config transformation coverage; the suite inherits Vitest's global jsdom setup and renders no UI.
import { migrateFixedGridConfig } from "@/config/loader";

describe("fixed-grid config migration", () => {
  it.each([undefined, "normal", "wide", "tall", "large"])("preserves historical Unraid geometry with legacy size %s", size => {
    const id = "10000000-0000-4000-8000-000000000001";
    const tile = { id: "20000000-0000-4000-8000-000000000001", service_id: id, size, widget: { type: "unraid-stats" } };
    const base = { schema_version: 2, services: [{ id, name: "Unraid", integration: { type: "unraid", config: { url: "http://unraid.local", api_key: "secret" } } }], service_tiles: [tile] };
    expect(migrateFixedGridConfig(base).service_tiles[0].footprint).toEqual({ columnSpan: 6, rowSpan: 4 });
    for (const footprint of [{ columnSpan: 3 }, { columnSpan: 9, rowSpan: 9 }]) {
      expect(migrateFixedGridConfig({ ...base, service_tiles: [{ ...tile, footprint }] }).service_tiles[0].footprint).toEqual({ columnSpan: 6, rowSpan: 4 });
    }
    for (const footprint of [{ columnSpan: 3, rowSpan: 2 }, { columnSpan: 6, rowSpan: 2 }, { columnSpan: 3, rowSpan: 4 }, { columnSpan: 6, rowSpan: 4 }]) {
      expect(migrateFixedGridConfig({ ...base, service_tiles: [{ ...tile, footprint }] }).service_tiles[0].footprint).toEqual(footprint);
    }
  });
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
        widget: { type: "unknown" },
      }],
    });
    expect(migrated.service_tiles[0].footprint).toEqual({ columnSpan: 99, rowSpan: 1 });
  });
  it.each(["wide", "tall", "large"] as const)(
    "normalizes a plain tile's legacy %s size to the generic footprint", (size) => {
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

    expect(migrated.service_tiles[0]).toMatchObject({ footprint: { columnSpan: 3, rowSpan: 1 } });
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

  it("preserves the historical wide qBittorrent Stats tile when legacy geometry is absent", () => {
    const serviceId = "10000000-0000-4000-8000-000000000001";
    const tileId = "20000000-0000-4000-8000-000000000002";
    const base = {
      schema_version: 2,
      services: [{
        id: serviceId,
        name: "qBittorrent",
        integration: { type: "qbittorrent", config: { url: "http://qbit.local:8080", username: "admin", password: "secret" } },
      }],
      service_tiles: [{ id: tileId, service_id: serviceId, widget: { type: "qbittorrent-stats" } }],
    };

    expect(migrateFixedGridConfig(base).service_tiles[0].footprint)
      .toEqual({ columnSpan: 6, rowSpan: 2 });
    expect(migrateFixedGridConfig({
      ...base,
      service_tiles: [{ ...base.service_tiles[0], size: "normal" }],
    }).service_tiles[0].footprint).toEqual({ columnSpan: 3, rowSpan: 2 });
    expect(migrateFixedGridConfig({
      ...base,
      service_tiles: [{ ...base.service_tiles[0], footprint: { columnSpan: 6, rowSpan: 2 } }],
    }).service_tiles[0].footprint).toEqual({ columnSpan: 6, rowSpan: 2 });
  });

  it.each([
    { widgetType: "radarr-stats", integrationType: "radarr", explicitSize: "tall", expected: { columnSpan: 3, rowSpan: 4 } },
    { widgetType: "seerr-stats", integrationType: "seerr", explicitSize: "normal", expected: { columnSpan: 3, rowSpan: 2 } },
    { widgetType: "tdarr-stats", integrationType: "tdarr", explicitSize: "normal", expected: { columnSpan: 3, rowSpan: 2 } },
    { widgetType: "sabnzbd", integrationType: "sabnzbd", explicitSize: "normal", expected: { columnSpan: 3, rowSpan: 2 } },
  ] as const)("preserves legacy wide $widgetType tiles while honoring saved geometry", ({ widgetType, integrationType, explicitSize, expected }) => {
    const serviceId = "10000000-0000-4000-8000-000000000001";
    const tile = { id: "20000000-0000-4000-8000-000000000002", service_id: serviceId, widget: { type: widgetType } };
    const base = {
      schema_version: 2,
      services: [{ id: serviceId, name: integrationType, integration: { type: integrationType, config: { url: "http://media.local", api_key: "secret", apikey: "secret" } } }],
      service_tiles: [tile],
    };

    expect(migrateFixedGridConfig(base).service_tiles[0].footprint).toEqual({ columnSpan: 6, rowSpan: 2 });
    expect(migrateFixedGridConfig({ ...base, service_tiles: [{ ...tile, size: explicitSize }] }).service_tiles[0].footprint).toEqual(expected);
    expect(migrateFixedGridConfig({ ...base, service_tiles: [{ ...tile, footprint: { columnSpan: 3, rowSpan: 4 } }] }).service_tiles[0].footprint).toEqual({ columnSpan: 3, rowSpan: 4 });
    expect(migrateFixedGridConfig({ ...base, service_tiles: [{ ...tile, footprint: { columnSpan: 6, rowSpan: 2 } }] }).service_tiles[0].footprint).toEqual({ columnSpan: 6, rowSpan: 2 });
    expect(migrateFixedGridConfig({ ...base, service_tiles: [{ ...tile, size: "large" }] }).service_tiles[0].footprint).toEqual({ columnSpan: 6, rowSpan: 2 });
    expect(migrateFixedGridConfig({ ...base, service_tiles: [{ ...tile, footprint: { columnSpan: 6, rowSpan: 4 } }] }).service_tiles[0].footprint).toEqual({ columnSpan: 6, rowSpan: 2 });
  });

  it("keeps described generic service cards at the fixed 3×1 footprint", () => {
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

    expect(migrated.service_tiles[0].footprint).toEqual({ columnSpan: 3, rowSpan: 1 });
  });
});


it("preserves historical wide Plex and explicit expanded geometry", () => {
  const tile = { id: "20000000-0000-4000-8000-000000000001", service_id: "10000000-0000-4000-8000-000000000001", widget: { type: "plex", config: { fields: ["library_movies"] } } };
  const base = { schema_version: 2, services: [{ id: tile.service_id, name: "Plex", integration: { type: "plex", config: { url: "http://plex", token: "token" } } }], service_tiles: [tile] };
  expect(migrateFixedGridConfig(base).service_tiles[0].footprint).toEqual({ columnSpan: 6, rowSpan: 2 });
  expect(migrateFixedGridConfig({ ...base, service_tiles: [{ ...tile, footprint: { columnSpan: 6, rowSpan: 4 } }] }).service_tiles[0].footprint).toEqual({ columnSpan: 6, rowSpan: 4 });
});
it.each([
  { size: "normal", footprint: undefined, config: undefined, expected: { columnSpan: 6, rowSpan: 2 } },
  { size: undefined, footprint: { rowSpan: 2 }, config: undefined, expected: { columnSpan: 6, rowSpan: 2 } },
  { size: "tall", footprint: { rowSpan: 2 }, config: undefined, expected: { columnSpan: 3, rowSpan: 4 } },
  { size: "large", footprint: { columnSpan: 3 }, config: undefined, expected: { columnSpan: 6, rowSpan: 4 } },
  { size: undefined, footprint: undefined, config: { size_defaults: true }, expected: { columnSpan: 3, rowSpan: 2 } },
  { size: undefined, footprint: { columnSpan: 3, rowSpan: 2 }, config: undefined, expected: { columnSpan: 3, rowSpan: 2 } },
])("normalizes Plex geometry without changing its options (%j)", ({ size, footprint, config, expected }) => {
  const tile = { id: "20000000-0000-4000-8000-000000000001", service_id: "10000000-0000-4000-8000-000000000001", size, footprint, widget: { type: "plex", config } };
  const migrated = migrateFixedGridConfig({ schema_version: 2, services: [{ id: tile.service_id, name: "Plex", integration: { type: "plex", config: { url: "http://plex", token: "token" } } }], service_tiles: [tile] });
  expect(migrated.service_tiles[0].footprint).toEqual(expected);
  expect(migrated.service_tiles[0].widget?.config).toEqual(config);
});
