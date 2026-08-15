import { describe, expect, it } from "vitest";
import {
  persistLegacyServices,
  projectCatalogServices,
  projectLegacyServices,
  splitWidgetConfig,
} from "@/components/edit/serviceFormProjection";
import {
  UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY,
  resolveServiceIntegrationSecrets,
  resolveServiceTileWidgetConfigs,
  toClientSafeSettings,
} from "@/widgets/configSecrets";
import { createWidgetConfigReference } from "@/widgets/secretReference.server";
import { duplicateService } from "@/config/duplicate";
import "@/integrations";

const serviceId = "10000000-0000-4000-8000-000000000001";
const tileId = "20000000-0000-4000-8000-000000000001";
const extraTileId = "20000000-0000-4000-8000-000000000002";

describe("serviceFormProjection", () => {
  it("projects a catalog-only integration as an editor-only representative without creating a tile", () => {
    const services = [{
      id: serviceId,
      name: "Sonarr",
      integration: { type: "sonarr", config: { url: "http://sonarr.local", api_key: "secret" } },
    }];
    const projected = projectCatalogServices(services, []);
    expect(projected[0]).toMatchObject({
      editorCatalogOnly: true,
      editorIntegration: { command: "preserve" },
    });
    expect(projected[0].widget).toBeUndefined();

    const persisted = persistLegacyServices(projected, services, []);
    expect(persisted.service_tiles).toEqual([]);
    expect(persisted.services[0].integration).toEqual(services[0].integration);

    const updated = persistLegacyServices([{
      ...projected[0],
      editorIntegration: {
        command: "set",
        type: "sonarr",
        config: { url: "http://replacement.local", api_key: "replacement" },
      },
    }], services, []);
    expect(updated.service_tiles).toEqual([]);
    expect(updated.services[0].integration).toEqual({
      type: "sonarr",
      config: { url: "http://replacement.local", api_key: "replacement" },
    });
  });
  it("projects and persists every tile of a shared service independently", () => {
    const services = [{ id: serviceId, name: "Sonarr", integration: { type: "sonarr", config: { url: "http://sonarr" } } }];
    const tiles = [
      { id: tileId, service_id: serviceId, group: "Media", widget: { type: "sonarr-calendar", config: { days: 7 } } },
      { id: extraTileId, service_id: serviceId, group: "Queue", widget: { type: "sonarr-queue", config: { limit: 3 } } },
    ];
    const projected = projectLegacyServices(services, tiles);
    expect(projected.map((service) => service.tileId)).toEqual([tileId, extraTileId]);
    const persisted = persistLegacyServices(projected, services, tiles);
    expect(persisted.services).toHaveLength(1);
    expect(persisted.service_tiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: tileId, group: "Media", widget: expect.objectContaining({ config: { days: 7 } }) }),
      expect.objectContaining({ id: extraTileId, group: "Queue", widget: expect.objectContaining({ config: { limit: 3 } }) }),
    ]));
  });

  it("projects dashboard tiles in canonical order without catalog-only phantom rows", () => {
    const catalogOnlyId = "10000000-0000-4000-8000-000000000099";
    const services = [
      { id: serviceId, name: "First" },
      { id: catalogOnlyId, name: "Catalog only" },
    ];
    const tiles = [
      { id: extraTileId, service_id: serviceId, group: "Second" },
      { id: tileId, service_id: serviceId, group: "First" },
    ];

    expect(projectLegacyServices(services, tiles).map((service) => service.tileId))
      .toEqual([extraTileId, tileId]);
    expect(projectCatalogServices(services, tiles).map((service) => service.name))
      .toEqual(["First", "First", "Catalog only"]);
  });

  it("does not retain a deleted sibling tile from the previous tile list", () => {
    const services = [{ id: serviceId, name: "Sonarr" }];
    const tiles = [
      { id: tileId, service_id: serviceId, group: "Calendar" },
      { id: extraTileId, service_id: serviceId, group: "Queue" },
    ];

    const persisted = persistLegacyServices(
      [projectLegacyServices(services, tiles)[0]],
      services,
      tiles
    );

    expect(persisted.service_tiles.map((tile) => tile.id)).toEqual([tileId]);
  });

  it("retains a shared integration when one sibling is changed to Generic", () => {
    const services = [{
      id: serviceId,
      name: "Sonarr",
      integration: { type: "sonarr", config: { url: "http://sonarr" } },
    }];
    const tiles = [
      { id: tileId, service_id: serviceId, widget: { type: "sonarr-calendar" } },
      { id: extraTileId, service_id: serviceId, widget: { type: "sonarr-queue" } },
    ];
    const inputs = projectLegacyServices(services, tiles);
    inputs[0] = { ...inputs[0], widget: undefined };

    expect(persistLegacyServices(inputs, services, tiles).services[0].integration)
      .toEqual(services[0].integration);
  });

  it("does not let an unedited plain sibling retain a cleared integration", () => {
    const services = [{
      id: serviceId,
      name: "Sonarr",
      integration: { type: "sonarr", config: { url: "http://sonarr" } },
    }];
    const tiles = [
      { id: tileId, service_id: serviceId, widget: { type: "sonarr-calendar" } },
      { id: extraTileId, service_id: serviceId, group: "Plain" },
    ];
    const inputs = projectLegacyServices(services, tiles);
    inputs[0] = { ...inputs[0], widget: undefined };

    expect(persistLegacyServices(inputs, services, tiles).services[0].integration).toBeUndefined();
  });

  it("clears a shared integration when every sibling is detached", () => {
    const services = [{
      id: serviceId,
      name: "Sonarr",
      integration: { type: "sonarr", config: { url: "http://sonarr" } },
    }];
    const tiles = [
      { id: tileId, service_id: serviceId, widget: { type: "sonarr-calendar" } },
      { id: extraTileId, service_id: serviceId, widget: { type: "sonarr-queue" } },
    ];
    const inputs = projectLegacyServices(services, tiles).map((input) => ({
      ...input,
      widget: { type: "system-stats", config: { sections: ["cpu"] } },
    }));

    expect(persistLegacyServices(inputs, services, tiles).services[0].integration).toBeUndefined();
  });

  it("optionally preserves unrepresented catalog-only services", () => {
    const catalogOnlyId = "10000000-0000-4000-8000-000000000099";
    const services = [{ id: serviceId, name: "Tiled" }, { id: catalogOnlyId, name: "Catalog only" }];
    const tiles = [{ id: tileId, service_id: serviceId }];
    const inputs = projectLegacyServices(services, tiles);

    expect(persistLegacyServices(inputs, services, tiles).services.map((service) => service.id))
      .toEqual([serviceId]);
    expect(persistLegacyServices(inputs, services, tiles, {
      preserveUnrepresentedCatalogServices: true,
    }).services.map((service) => service.id)).toEqual([serviceId, catalogOnlyId]);
  });

  it("preserves a previously tiled catalog Service after its last tile is deleted", () => {
    const services = [{
      id: serviceId,
      name: "Plex",
      integration: { type: "plex", config: { url: "http://plex", token: "secret" } },
    }];
    const tiles = [{ id: tileId, service_id: serviceId, widget: { type: "plex" } }];

    const persisted = persistLegacyServices([], services, tiles, {
      preserveUnrepresentedCatalogServices: true,
    });

    expect(persisted.services).toEqual(services);
    expect(persisted.service_tiles).toEqual([]);
  });

  it("preserves a catalog-only integration during a presentation edit", () => {
    const services = [{
      id: serviceId,
      name: "Plex",
      integration: { type: "plex", config: { url: "http://plex", token: "opaque-ref" } },
    }];
    const [input] = projectCatalogServices(services, []);
    const persisted = persistLegacyServices([
      {
        ...input,
        name: "Plex renamed",
        group: undefined,
        size: undefined,
        widget: undefined,
      },
    ], services, []);

    expect(persisted.services).toEqual([
      expect.objectContaining({
        name: "Plex renamed",
        integration: services[0].integration,
      }),
    ]);
    expect(persisted.service_tiles).toEqual([]);
  });

  it("uses input service order by default but can preserve dashboard catalog order", () => {
    const secondServiceId = "10000000-0000-4000-8000-000000000002";
    const services = [
      { id: serviceId, name: "First" },
      { id: secondServiceId, name: "Second" },
    ];
    const inputs = [
      { id: secondServiceId, name: "Second" },
      { id: serviceId, name: "First" },
    ];

    expect(persistLegacyServices(inputs, services, []).services.map((service) => service.id))
      .toEqual([secondServiceId, serviceId]);
    expect(persistLegacyServices(inputs, services, [], {
      preservePreviousServiceOrder: true,
    }).services.map((service) => service.id)).toEqual([serviceId, secondServiceId]);
  });

  it("persists a new widget service with its integration and tile options", () => {
    const persisted = persistLegacyServices([{
      name: "Plex",
      url: "http://plex",
      widget: {
        type: "plex",
        config: { url: "http://plex", token: "plex-token", fields: ["streams"] },
      },
    }], [], []);

    expect(persisted.services).toHaveLength(1);
    expect(persisted.services[0]).toMatchObject({
      integration: { type: "plex", config: { url: "http://plex", token: "plex-token" } },
    });
    expect(persisted.service_tiles).toEqual([expect.objectContaining({
      service_id: persisted.services[0].id,
      widget: { type: "plex", config: { fields: ["streams"] } },
    })]);
  });

  it("persists an unconfigured new integration widget with an empty connection", () => {
    for (const config of [undefined, {}]) {
      const persisted = persistLegacyServices([{
        name: "Plex",
        widget: { type: "plex", config },
      }], [], []);

      expect(persisted.services[0].integration).toEqual({ type: "plex", config: {} });
      expect(persisted.service_tiles[0].widget?.type).toBe("plex");
    }
  });

  it("uses a changed second tile connection while preserving every tile option", () => {
    const services = [{
      id: serviceId,
      name: "Sonarr",
      integration: { type: "sonarr", config: { url: "http://sonarr", api_key: "secret" } },
    }];
    const tiles = [
      { id: tileId, service_id: serviceId, widget: { type: "sonarr-calendar", config: { days: 7 } } },
      { id: extraTileId, service_id: serviceId, widget: { type: "sonarr-queue", config: { limit: 3 } } },
    ];
    const projected = projectLegacyServices(services, tiles);
    projected[1] = {
      ...projected[1],
      widget: {
        ...projected[1].widget!,
        config: { ...projected[1].widget!.config, url: "http://sonarr-new", api_key: "secret-new" },
      },
    };

    const persisted = persistLegacyServices(projected, services, tiles);

    expect(persisted.services[0].integration).toEqual({
      type: "sonarr",
      config: { url: "http://sonarr-new", api_key: "secret-new" },
    });
    expect(persisted.service_tiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: tileId, widget: { type: "sonarr-calendar", config: { days: 7 } } }),
      expect.objectContaining({ id: extraTileId, widget: { type: "sonarr-queue", config: { limit: 3 } } }),
    ]));
  });

  it("keeps an opaque known-widget tile config out of the shared integration", () => {
    const opaque = createWidgetConfigReference(tileId, "plex");
    const services = [{
      id: serviceId,
      name: "Plex",
      integration: { type: "plex", config: { url: "http://plex", api_key: "secret" } },
    }];
    const tiles = [{
      id: tileId,
      service_id: serviceId,
      widget: {
        type: "plex",
        config: { [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: opaque },
      },
    }];
    const [projected] = projectLegacyServices(services, tiles);

    expect(projected.widget?.config).toEqual({
      [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: opaque,
    });
    expect(projected.editorIntegrationConfig).toEqual({ url: "http://plex", api_key: "secret" });

    const persisted = persistLegacyServices([{ ...projected, name: "Plex renamed" }], services, tiles);

    expect(persisted.services[0].integration).toEqual(services[0].integration);
    expect(persisted.service_tiles[0].widget?.config).toEqual({
      [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: opaque,
    });
  });

  it("keeps an opaque tile reference while editing visible tile options", () => {
    const opaque = createWidgetConfigReference(tileId, "tautulli-activity");
    const services = [{ id: serviceId, name: "Tautulli" }];
    const tiles = [{
      id: tileId,
      service_id: serviceId,
      widget: {
        type: "tautulli-activity",
        config: { [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: opaque },
      },
    }];
    const [projected] = projectLegacyServices(services, tiles);

    const persisted = persistLegacyServices([{
      ...projected,
      widget: {
        ...projected.widget!,
        config: { ...projected.widget!.config, sections: ["sessions"] },
      },
    }], services, tiles);

    expect(persisted.service_tiles[0].widget?.config).toEqual({
      [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: opaque,
      sections: ["sessions"],
    });
  });

  it("does not preserve an opaque tile config when the widget type changes", () => {
    const opaque = createWidgetConfigReference(tileId, "plex");
    const services = [{ id: serviceId, name: "Plex" }];
    const tiles = [{
      id: tileId,
      service_id: serviceId,
      widget: { type: "plex", config: { [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: opaque } },
    }];
    const [projected] = projectLegacyServices(services, tiles);

    const persisted = persistLegacyServices([{
      ...projected,
      widget: { type: "system-stats", config: {} },
    }], services, tiles);

    expect(persisted.service_tiles[0].widget).toEqual({ type: "system-stats", config: {} });
  });

  it("preserves an opaque service config beside safe tile options", () => {
    const opaque = createWidgetConfigReference(serviceId, "plex");
    const services = [{
      id: serviceId,
      name: "Plex",
      integration: { type: "plex", config: { [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: opaque } },
    }];
    const tiles = [{
      id: tileId,
      service_id: serviceId,
      widget: { type: "plex", config: { fields: ["streams"] } },
    }];
    const [projected] = projectLegacyServices(services, tiles);

    expect(projected.widget?.config).toEqual({ fields: ["streams"] });
    expect(projected.editorIntegrationConfig).toEqual(services[0].integration.config);
    expect(projected.editorTileWidgetConfig).toEqual(tiles[0].widget.config);

    const persisted = persistLegacyServices([{ ...projected, name: "Plex renamed" }], services, tiles);

    expect(persisted.services[0].integration?.config).toEqual(services[0].integration.config);
    expect(persisted.service_tiles[0].widget?.config).toEqual(tiles[0].widget.config);
  });

  it("updates the shared connection while replacing an opaque tile config", () => {
    const opaque = createWidgetConfigReference(tileId, "plex");
    const services = [{
      id: serviceId,
      name: "Plex",
      integration: { type: "plex", config: { url: "http://plex-old", token: "old-token" } },
    }];
    const tiles = [{
      id: tileId,
      service_id: serviceId,
      widget: { type: "plex", config: { [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: opaque } },
    }];
    const [projected] = projectLegacyServices(services, tiles);
    const persisted = persistLegacyServices([{
      ...projected,
      widget: { ...projected.widget!, config: {
        url: "http://plex-new",
        token: "new-token",
        fields: ["streams"],
      } },
    }], services, tiles);

    expect(persisted.services[0].integration).toEqual({
      type: "plex",
      config: { url: "http://plex-new", token: "new-token" },
    });
    expect(persisted.service_tiles[0].widget?.config).toEqual({ fields: ["streams"] });
  });

  it("uses shared presentation fields changed through a second projected tile", () => {
    const services = [{
      id: serviceId,
      name: "Sonarr",
      launch_url: "http://sonarr-old",
      icon: "old-icon",
      description: "old description",
      category: "Old",
    }];
    const tiles = [
      { id: tileId, service_id: serviceId, widget: { type: "sonarr-calendar", config: { days: 7 } } },
      { id: extraTileId, service_id: serviceId, widget: { type: "sonarr-queue", config: { limit: 3 } } },
    ];
    const projected = projectLegacyServices(services, tiles);
    projected[1] = {
      ...projected[1],
      name: "Sonarr renamed",
      url: "http://sonarr-new",
      icon: "new-icon",
      description: "new description",
      category: "New",
    };

    const persisted = persistLegacyServices(projected, services, tiles);

    expect(persisted.services[0]).toMatchObject({
      name: "Sonarr renamed",
      launch_url: "http://sonarr-new",
      icon: "new-icon",
      description: "new description",
      category: "New",
    });
  });

  it("keeps the service category when a second tile edit omits it", () => {
    const services = [{
      id: serviceId,
      name: "Sonarr",
      launch_url: "http://sonarr-old",
      category: "Media",
      integration: { type: "sonarr", config: { url: "http://sonarr-old", api_key: "old-key" } },
    }];
    const tiles = [
      { id: tileId, service_id: serviceId, group: "Media", widget: { type: "sonarr-calendar", config: { days: 7 } } },
      { id: extraTileId, service_id: serviceId, group: "Queue", widget: { type: "sonarr-queue", config: { limit: 3 } } },
    ];
    const projected = projectLegacyServices(services, tiles);
    const { category: _category, ...secondWithoutCategory } = projected[1];
    projected[1] = {
      ...secondWithoutCategory,
      name: "Sonarr renamed",
      url: "http://sonarr-new",
      widget: {
        ...secondWithoutCategory.widget!,
        config: { ...secondWithoutCategory.widget!.config, url: "http://sonarr-new", api_key: "new-key" },
      },
    };

    const persisted = persistLegacyServices(projected, services, tiles);

    expect(persisted.services[0]).toMatchObject({
      name: "Sonarr renamed",
      launch_url: "http://sonarr-new",
      category: "Media",
    });
  });

  it("uses the selected widget integration type when changing integrations", () => {
    const services = [{
      id: serviceId,
      name: "Sonarr",
      integration: { type: "sonarr", config: { url: "http://sonarr", api_key: "sonarr-key" } },
    }];
    const tiles = [{
      id: tileId,
      service_id: serviceId,
      widget: { type: "sonarr-calendar", config: { days: 7 } },
    }];
    const [projected] = projectLegacyServices(services, tiles);
    const persisted = persistLegacyServices([{
      ...projected,
      widget: {
        type: "plex",
        config: { url: "http://plex", token: "plex-token", fields: ["streams"] },
      },
    }], services, tiles);

    expect(persisted.services[0].integration).toEqual({
      type: "plex",
      config: { url: "http://plex", token: "plex-token" },
    });
    expect(persisted.service_tiles[0].widget).toEqual({
      type: "plex",
      config: { fields: ["streams"] },
    });
  });

  it("does not reuse the old integration when switching to a different widget type", () => {
    const services = [{
      id: serviceId,
      name: "Sonarr",
      integration: { type: "sonarr", config: { url: "http://sonarr", api_key: "sonarr-key" } },
    }];
    const tiles = [{
      id: tileId,
      service_id: serviceId,
      widget: { type: "sonarr-calendar", config: { days: 7 } },
    }];
    const [projected] = projectLegacyServices(services, tiles);
    const persisted = persistLegacyServices([{
      ...projected,
      widget: {
        type: "plex",
        config: {},
      },
    }], services, tiles);

    expect(persisted.services[0]).toMatchObject({
      integration: {
        type: "plex",
        config: {},
      },
    });
    expect(persisted.service_tiles[0].widget).toEqual({
      type: "plex",
      config: {},
    });
  });

  it("retains the shared integration when switching within the same integration family", () => {
    const services = [{
      id: serviceId,
      name: "Sonarr",
      integration: { type: "sonarr", config: { url: "http://sonarr", api_key: "sonarr-key" } },
    }];
    const tiles = [{
      id: tileId,
      service_id: serviceId,
      widget: { type: "sonarr-calendar", config: { days: 7 } },
    }];
    const [projected] = projectLegacyServices(services, tiles);
    const persisted = persistLegacyServices([{
      ...projected,
      widget: {
        type: "sonarr-queue",
        config: {},
      },
    }], services, tiles);

    expect(persisted.services[0]).toMatchObject({
      integration: {
        type: "sonarr",
        config: { url: "http://sonarr", api_key: "sonarr-key" },
      },
    });
    expect(persisted.service_tiles[0].widget).toEqual({
      type: "sonarr-queue",
      config: {},
    });
  });

  it("retains a sibling's connection when attaching a plain tile to the same integration", () => {
    const services = [{
      id: serviceId,
      name: "Sonarr",
      integration: {
        type: "sonarr",
        config: { url: "http://sonarr", api_key: "sonarr-key" },
      },
    }];
    const tiles = [
      { id: tileId, service_id: serviceId },
      {
        id: extraTileId,
        service_id: serviceId,
        widget: { type: "sonarr-calendar", config: { days: 7 } },
      },
    ];
    const projected = projectLegacyServices(services, tiles);
    const persisted = persistLegacyServices([
      {
        ...projected[0],
        widget: { type: "sonarr-queue", config: {} },
      },
      projected[1],
    ], services, tiles);

    expect(persisted.services[0].integration).toEqual(services[0].integration);
    expect(persisted.service_tiles.map((tile) => tile.widget?.type)).toEqual([
      "sonarr-queue",
      "sonarr-calendar",
    ]);
  });

  it("round-trips distinct opaque integration and tile configs after a presentation edit", () => {
    const saved = {
      schema_version: 2 as const,
      auth: { enabled: false, session_ttl_hours: 24 },
      appearance: { theme: "dark" as const },
      layout: { columns: 4, row_height: 120 },
      services: [{
        id: serviceId,
        name: "Tautulli",
        integration: {
          type: "tautulli",
          config: {
            url: "http://tautulli",
            api_key: "integration-secret",
            future_connection_option: "future-value",
          },
        },
      }],
      service_tiles: [{
        id: tileId,
        service_id: serviceId,
        widget: {
          type: "tautulli-activity",
          config: { api_key: "tile-secret", sections: ["summary"] },
        },
      }],
    };
    const safe = toClientSafeSettings(saved);

    expect(safe.services[0].integration?.config).toEqual({
      [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: expect.any(String),
    });
    expect(safe.service_tiles[0].widget?.config).toEqual({
      [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: expect.any(String),
    });

    const [projected] = projectLegacyServices(safe.services, safe.service_tiles);
    const persisted = persistLegacyServices(
      [{ ...projected, name: "Tautulli renamed" }],
      safe.services,
      safe.service_tiles
    );
    const restoredServices = resolveServiceIntegrationSecrets(
      persisted.services,
      saved.services
    );
    const restoredTiles = resolveServiceTileWidgetConfigs(
      persisted.service_tiles,
      saved.service_tiles
    );

    expect(restoredServices[0].integration?.config).toEqual(
      saved.services[0].integration.config
    );
    expect(restoredTiles[0].widget?.config).toEqual(
      saved.service_tiles[0].widget.config
    );
  });

  it("duplicates a credentialed projected tile with new identities and no secret references", () => {
    const services = [{ id: serviceId, name: "Sonarr", integration: { type: "sonarr", config: { url: "http://sonarr", api_key: createWidgetConfigReference(serviceId, "sonarr") } } }];
    const tiles = [{ id: tileId, service_id: serviceId, widget: { type: "sonarr-calendar", config: { days: 7 } } }];
    const duplicated = duplicateService(projectLegacyServices(services, tiles), serviceId);
    const persisted = persistLegacyServices(duplicated, services, tiles);
    expect(persisted.services).toHaveLength(2);
    expect(persisted.services[1]).toMatchObject({ name: "Sonarr copy" });
    expect(persisted.services[1].id).not.toBe(serviceId);
    expect(persisted.services[1].integration?.config).toEqual({ url: "http://sonarr" });
    expect(persisted.service_tiles).toHaveLength(2);
    expect(persisted.service_tiles[1].id).not.toBe(tileId);
    expect(persisted.service_tiles[1].service_id).toBe(persisted.services[1].id);
  });

  it("does not carry an opaque tile reference onto a duplicated tile", () => {
    const opaque = createWidgetConfigReference(tileId, "plex");
    const saved = {
      schema_version: 2 as const,
      auth: { enabled: false, session_ttl_hours: 24 },
      appearance: { theme: "dark" as const },
      layout: { columns: 4, row_height: 120 },
      services: [{
        id: serviceId,
        name: "Plex",
        integration: { type: "plex", config: { url: "http://plex", token: "secret" } },
      }],
      service_tiles: [{
        id: tileId,
        service_id: serviceId,
        widget: { type: "plex", config: { [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: opaque } },
      }],
    };
    const safe = toClientSafeSettings(saved);
    const duplicated = duplicateService(
      projectLegacyServices(safe.services, safe.service_tiles),
      serviceId
    );
    const duplicate = duplicated[1];
    expect(duplicate.id).not.toBe(serviceId);
    expect(duplicate.tileId).not.toBe(tileId);
    expect(duplicate.editorIntegrationConfig).toBeUndefined();
    expect(duplicate.editorTileWidgetConfig).toBeUndefined();

    const persisted = persistLegacyServices(
      duplicated,
      safe.services,
      safe.service_tiles
    );
    const clone = persisted.services[1];
    const cloneTile = persisted.service_tiles.find((tile) => tile.service_id === clone.id)!;

    expect(clone.integration?.config).toEqual({ url: "http://plex" });
    expect(JSON.stringify({ clone, cloneTile }))
      .not.toContain(UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY);
    expect(JSON.stringify({ clone, cloneTile })).not.toContain(opaque);
    expect(JSON.stringify({ clone, cloneTile })).not.toContain("secret");
  });

  it("projects connection and tile options separately, then preserves their boundary", () => {
    const services = [{
      id: serviceId,
      name: "Sonarr",
      launch_url: "http://sonarr.local",
      integration: { type: "sonarr", config: { url: "http://sonarr.local", api_key: "widget-secret-ref.sonarr" } },
    }];
    const service_tiles = [
      { id: tileId, service_id: serviceId, widget: { type: "sonarr-calendar", config: { days: 14 } } },
      { id: extraTileId, service_id: serviceId, group: "Secondary", widget: { type: "sonarr-queue", config: { limit: 5 } } },
    ];

    const [input] = projectLegacyServices(services, service_tiles);
    expect(input.editorIntegrationConfig).toEqual({
      url: "http://sonarr.local",
      api_key: "widget-secret-ref.sonarr",
    });
    expect(input.widget?.config).toEqual({ days: 14 });

    const persisted = persistLegacyServices([{ ...input, name: "Sonarr renamed" }], services, service_tiles);
    expect(persisted.services[0]).toMatchObject({ id: serviceId, integration: { config: { url: "http://sonarr.local", api_key: "widget-secret-ref.sonarr" } } });
    expect(persisted.service_tiles).toEqual([
      expect.objectContaining({ id: tileId, widget: { type: "sonarr-calendar", config: { days: 14 } } }),
    ]);
  });

  it("persists Tautulli display sections as per-tile options", () => {
    const services = [{
      id: serviceId,
      name: "Tautulli",
      integration: {
        type: "tautulli",
        config: { url: "http://tautulli", api_key: "secret" },
      },
    }];
    const tiles = [
      { id: tileId, service_id: serviceId, widget: { type: "tautulli-activity", config: { sections: ["summary"] } } },
      { id: extraTileId, service_id: serviceId, widget: { type: "tautulli-activity", config: { sections: ["sessions"] } } },
    ];

    const persisted = persistLegacyServices(
      projectLegacyServices(services, tiles),
      services,
      tiles
    );

    expect(persisted.services[0].integration?.config).toEqual({
      url: "http://tautulli",
      api_key: "secret",
    });
    expect(persisted.service_tiles.map((tile) => tile.widget?.config)).toEqual([
      { sections: ["summary"] },
      { sections: ["sessions"] },
    ]);
  });

  it("keeps Actual Budget display settings and each widget's existing options on its tile", () => {
    const connection = {
      url: "http://actual-http-api",
      api_key: "secret",
      budget_sync_id: "budget-id",
      encryption_password: "password",
    };
    const cases = [
      ["actualbudget-categories", {
        limit: 8,
        category_ids: ["groceries"],
        timezone: "Europe/Warsaw",
        hide_income: true,
        hide_empty: false,
      }],
      ["actualbudget-accounts", {
        account_ids: ["checking"],
        timezone: "Europe/Warsaw",
        exclude_closed: true,
        exclude_offbudget: false,
      }],
      ["actualbudget-schedules", {
        days_ahead: 30,
        timezone: "Europe/Warsaw",
        limit: 6,
      }],
      ["actualbudget-summary", {
        timezone: "Europe/Warsaw",
        sections: ["budget"],
      }],
    ] as const;

    for (const [widgetType, existingOptions] of cases) {
      expect(splitWidgetConfig(widgetType, {
        ...connection,
        ...existingOptions,
        currency: "EUR",
        locale: "pl-PL",
        privacy_mode: true,
      })).toEqual({
        connection,
        options: {
          ...existingOptions,
          currency: "EUR",
          locale: "pl-PL",
          privacy_mode: true,
        },
      });
    }
  });

  it("keeps integration-free widget configuration on the tile", () => {
    expect(splitWidgetConfig("system-stats", { sections: ["cpu"] })).toEqual({
      connection: {},
      options: { sections: ["cpu"] },
    });
  });

  it("preserves unknown widget integration and tile config boundaries", () => {
    const opaque = createWidgetConfigReference(serviceId, "removed-widget");
    const services = [{
      id: serviceId,
      name: "Retired",
      integration: {
        type: "removed-widget",
        config: { endpoint: "https://retired.local", api_key: "saved-secret" },
      },
    }];
    const service_tiles = [
      { id: tileId, service_id: serviceId, widget: { type: "removed-widget", config: { layout: "compact" }, fields: ["status"] } },
      { id: extraTileId, service_id: serviceId, widget: { type: "removed-widget", config: { layout: "secondary" } } },
    ];
    const browserServices = [{
      ...services[0],
      integration: {
        ...services[0].integration,
        config: { [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: opaque },
      },
    }];
    const [input] = projectLegacyServices(browserServices, service_tiles);
    input.widget = { ...input.widget!, refresh_interval_ms: 60_000 };
    input.name = "Retired renamed";

    const persisted = persistLegacyServices([{ ...input, widget: {
      ...input.widget!,
      config: { [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: opaque, layout: "compact" },
    } }], browserServices, service_tiles);
    expect(persisted.services[0].integration?.config).toEqual({
      [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: opaque,
    });
    expect(persisted.service_tiles).toEqual([
      expect.objectContaining({ id: tileId, widget: expect.objectContaining({ config: { layout: "compact" }, refresh_interval_ms: 60_000 }) }),
    ]);
    expect(resolveServiceIntegrationSecrets(persisted.services, services)[0].integration?.config)
      .toEqual(services[0].integration?.config);
  });

  it("does not synthesize an integration for an unknown tile-only widget", () => {
    const persisted = persistLegacyServices([{
      id: serviceId,
      name: "Retired",
      widget: { type: "removed-widget", config: { layout: "compact" } },
    }], [{ id: serviceId, name: "Retired" }], [
      { id: tileId, service_id: serviceId, widget: { type: "removed-widget", config: { layout: "compact" } } },
    ]);
    expect(persisted.services[0].integration).toBeUndefined();
    expect(persisted.service_tiles[0].widget?.config).toEqual({ layout: "compact" });
  });

  it("does not copy an opaque integration marker into an unknown tile without config", () => {
    const opaque = createWidgetConfigReference(serviceId, "removed-widget");
    const savedServices = [{
      id: serviceId,
      name: "Retired",
      integration: {
        type: "removed-widget",
        config: { endpoint: "https://retired.local", api_key: "saved-secret" },
      },
    }];
    const browserServices = [{
      ...savedServices[0],
      integration: {
        ...savedServices[0].integration,
        config: { [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: opaque },
      },
    }];
    const tiles = [{
      id: tileId,
      service_id: serviceId,
      widget: { type: "removed-widget" },
    }];

    const projected = projectLegacyServices(browserServices, tiles);
    const persisted = persistLegacyServices(projected, browserServices, tiles);

    expect(persisted.services[0].integration?.config).toEqual({
      [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: opaque,
    });
    expect(persisted.service_tiles[0].widget?.config).toBeUndefined();
    expect(resolveServiceIntegrationSecrets(persisted.services, savedServices)[0].integration?.config)
      .toEqual(savedServices[0].integration?.config);
  });

  it("removes a previous integration when switching to an integration-free widget", () => {
    const persisted = persistLegacyServices([{
      id: serviceId,
      name: "System",
      widget: { type: "system-stats", config: { sections: ["cpu"] } },
    }], [{
      id: serviceId,
      name: "System",
      integration: { type: "sonarr", config: { url: "http://sonarr.local", api_key: "secret" } },
    }], [{ id: tileId, service_id: serviceId, widget: { type: "sonarr-calendar" } }]);
    expect(persisted.services[0].integration).toBeUndefined();
    expect(persisted.service_tiles[0].widget?.config).toEqual({ sections: ["cpu"] });
  });

  it("preserves a reusable integration when repositioning an existing integration-free tile", () => {
    const services = [{
      id: serviceId,
      name: "System",
      integration: { type: "sonarr", config: { url: "http://sonarr.local", api_key: "secret" } },
    }];
    const tiles = [{
      id: tileId,
      service_id: serviceId,
      group: "System",
      size: "normal" as const,
      widget: { type: "system-stats", config: { sections: ["cpu"] } },
    }];
    const [projected] = projectLegacyServices(services, tiles);

    const persisted = persistLegacyServices([{
      ...projected,
      group: "Infrastructure",
      size: "wide",
    }], services, tiles);

    expect(persisted.services[0].integration).toEqual(services[0].integration);
    expect(persisted.service_tiles[0]).toMatchObject({
      id: tileId,
      group: "Infrastructure",
      size: "wide",
      widget: { type: "system-stats", config: { sections: ["cpu"] } },
    });
  });

  it("honors explicit clears from the service form without restoring prior tile state", () => {
    const services = [{
      id: serviceId,
      name: "Plex",
      integration: { type: "plex", config: { url: "http://plex.local", api_key: "secret" } },
    }];
    const tiles = [{
      id: tileId,
      service_id: serviceId,
      group: "Media",
      size: "large" as const,
      widget: { type: "plex", config: { fields: ["streams"] } },
    }];

    const persisted = persistLegacyServices([{
      id: serviceId,
      name: "Plex",
      group: undefined,
      size: undefined,
      widget: undefined,
    }], services, tiles);

    expect(persisted.services[0].integration).toBeUndefined();
    expect(persisted.service_tiles[0]).toEqual({
      id: tileId,
      service_id: serviceId,
      footprint: { columnSpan: 3, rowSpan: 1 },
    });
  });

  it("keeps prior tile fields when an input truly omits them", () => {
    const services = [{ id: serviceId, name: "Plex" }];
    const tiles = [{ id: tileId, service_id: serviceId, group: "Media", size: "wide" as const }];
    const persisted = persistLegacyServices([{ id: serviceId, name: "Renamed" }], services, tiles);
    expect(persisted.service_tiles[0]).toMatchObject({ group: "Media", size: "wide" });
  });

  it("normalizes all plain-service geometry paths to the generic footprint", () => {
    const services = [{ id: serviceId, name: "Plex" }];
    const copied = persistLegacyServices([{
      id: serviceId,
      tileId: "20000000-0000-4000-8000-000000000099",
      name: "Plex copy",
      footprint: { columnSpan: 9, rowSpan: 3 },
    }], services, []);
    expect(copied.service_tiles[0].footprint).toEqual({ columnSpan: 3, rowSpan: 1 });

    const tiles = [{
      id: tileId,
      service_id: serviceId,
      size: "normal" as const,
      footprint: { columnSpan: 3, rowSpan: 2 },
    }];
    const resized = persistLegacyServices([{
      id: serviceId,
      tileId,
      name: "Plex",
      size: "wide",
      footprint: { columnSpan: 3, rowSpan: 2 },
    }], services, tiles);
    expect(resized.service_tiles[0].footprint).toEqual({ columnSpan: 3, rowSpan: 1 });
  });

  it("keeps plain normal and described cards at the same fixed footprint", () => {
    const services = [{ id: serviceId, name: "Plain" }];
    const compact = persistLegacyServices([{
      id: serviceId,
      name: "Plain",
      size: "normal",
    }], services, []);
    expect(compact.service_tiles[0].footprint).toEqual({ columnSpan: 3, rowSpan: 1 });

    const described = persistLegacyServices([{
      id: serviceId,
      name: "Plain",
      description: "Visible details",
      size: "normal",
    }], services, []);
    expect(described.service_tiles[0].footprint).toEqual({ columnSpan: 3, rowSpan: 1 });
  });

  it("uses a widget's preferred and minimum size for an automatic footprint", () => {
    const services = [{ id: serviceId, name: "Sonarr" }];
    const persisted = persistLegacyServices([{
      id: serviceId,
      name: "Sonarr",
      widget: { type: "sonarr-queue" },
    }], services, []);

    expect(persisted.service_tiles[0].footprint).toEqual({ columnSpan: 3, rowSpan: 4 });
  });

  it("clears a catalog-only integration without creating a presentation tile", () => {
    const services = [{
      id: serviceId,
      name: "Sonarr",
      integration: { type: "sonarr", config: { url: "http://sonarr", api_key: "key" } },
    }];
    const [catalog] = projectCatalogServices(services, []);
    const persisted = persistLegacyServices([{
      ...catalog,
      editorIntegration: { command: "clear" },
    }], services, []);
    expect(persisted.services[0].integration).toBeUndefined();
    expect(persisted.service_tiles).toEqual([]);
  });

  it("keeps a plain tile plain while explicitly editing or clearing its Service integration", () => {
    const services = [{
      id: serviceId,
      name: "Sonarr",
      integration: { type: "sonarr", config: { url: "http://old", api_key: "old" } },
    }];
    const tiles = [{ id: tileId, service_id: serviceId, group: "Media" }];
    const [plain] = projectLegacyServices(services, tiles);
    const updated = persistLegacyServices([{
      ...plain,
      name: "Renamed",
      editorIntegration: { command: "set", type: "sonarr", config: { url: "http://new", api_key: "new" } },
    }], services, tiles);
    expect(updated.service_tiles[0].widget).toBeUndefined();
    expect(updated.services[0].integration?.config).toEqual({ url: "http://new", api_key: "new" });

    const cleared = persistLegacyServices([{
      ...plain,
      editorIntegration: { command: "clear" },
    }], services, tiles);
    expect(cleared.service_tiles[0].widget).toBeUndefined();
    expect(cleared.services[0].integration).toBeUndefined();
  });

  it("attaches a tile widget independently from an existing Service integration", () => {
    const services = [{ id: serviceId, name: "Sonarr", integration: { type: "sonarr", config: { url: "http://sonarr", api_key: "key" } } }];
    const tiles = [{ id: tileId, service_id: serviceId }];
    const [plain] = projectLegacyServices(services, tiles);
    const persisted = persistLegacyServices([{
      ...plain,
      widget: { type: "system-stats", config: { sections: ["cpu"] } },
      editorIntegration: { command: "preserve" },
    }], services, tiles);
    expect(persisted.services[0].integration).toEqual(services[0].integration);
    expect(persisted.service_tiles[0].widget).toEqual({ type: "system-stats", config: { sections: ["cpu"] } });
  });

  it("marks every no-tile Service as catalog context and never turns an integration-free widget into an integration", () => {
    const projected = projectCatalogServices([
      { id: serviceId, name: "No integration" },
      { id: "10000000-0000-4000-8000-000000000002", name: "Integrated", integration: { type: "sonarr", config: {} } },
    ], []);
    expect(projected.every((service) => service.editorCatalogOnly)).toBe(true);
    expect(() => persistLegacyServices([{
      id: serviceId,
      name: "System",
      editorIntegration: { command: "set", type: "system-stats", config: {} },
    }], [{ id: serviceId, name: "System" }], [])).toThrow(/Unsupported Service integration/);
  });

  it("rejects conflicting explicit integration commands deterministically", () => {
    expect(() => persistLegacyServices([
      { id: serviceId, name: "One", editorIntegration: { command: "set", type: "sonarr", config: {} } },
      { id: serviceId, name: "One", editorIntegration: { command: "set", type: "plex", config: {} } },
    ], [{ id: serviceId, name: "One" }], [])).toThrow(/Conflicting explicit integration commands/);
  });

  it("rejects clearing or replacing an integration required by a remaining tile", () => {
    const services = [{
      id: serviceId,
      name: "Sonarr",
      integration: { type: "sonarr", config: { url: "http://sonarr", api_key: "key" } },
    }];
    const tiles = [{
      id: tileId,
      service_id: serviceId,
      widget: { type: "sonarr-calendar", config: { days: 7 } },
    }];
    const [projected] = projectLegacyServices(services, tiles);

    expect(() => persistLegacyServices([{
      ...projected,
      editorIntegration: { command: "clear" },
    }], services, tiles)).toThrow(/integration must match its sonarr tile/);

    expect(() => persistLegacyServices([{
      ...projected,
      editorIntegration: { command: "set", type: "plex", config: {} },
    }], services, tiles)).toThrow(/integration must match its sonarr tile/);
  });

  it("allows sibling tiles that require the same Service integration", () => {
    const services = [{
      id: serviceId,
      name: "Sonarr",
      integration: { type: "sonarr", config: { url: "http://sonarr", api_key: "key" } },
    }];
    const tiles = [
      { id: tileId, service_id: serviceId, widget: { type: "sonarr-calendar" } },
      { id: extraTileId, service_id: serviceId, widget: { type: "sonarr-queue" } },
    ];

    expect(persistLegacyServices(
      projectLegacyServices(services, tiles),
      services,
      tiles
    ).service_tiles).toHaveLength(2);
  });

  it("applies an explicit integration edit regardless of sibling input order", () => {
    const services = [{
      id: serviceId,
      name: "Sonarr",
      integration: { type: "sonarr", config: { url: "http://old", api_key: "old" } },
    }];
    const tiles = [
      { id: tileId, service_id: serviceId, widget: { type: "sonarr-calendar" } },
      { id: extraTileId, service_id: serviceId, widget: { type: "sonarr-queue" } },
    ];
    const projected = projectLegacyServices(services, tiles);
    const edited = {
      ...projected[0],
      editorIntegration: {
        command: "set" as const,
        type: "sonarr",
        config: { url: "http://new", api_key: "new" },
      },
    };

    for (const inputs of [[edited, projected[1]], [projected[1], edited]]) {
      expect(persistLegacyServices(inputs, services, tiles).services[0].integration).toEqual({
        type: "sonarr",
        config: { url: "http://new", api_key: "new" },
      });
    }
  });

  it("treats structurally equal nested integration configs as the same command", () => {
    const config = { url: "http://sonarr", headers: { authorization: "token", accept: "json" } };
    const reorderedConfig = { headers: { accept: "json", authorization: "token" }, url: "http://sonarr" };
    const inputs = [
      {
        id: serviceId,
        name: "Sonarr",
        editorIntegration: { command: "set" as const, type: "sonarr", config },
      },
      {
        id: serviceId,
        name: "Sonarr",
        editorIntegration: { command: "set" as const, type: "sonarr", config: reorderedConfig },
      },
    ];

    expect(persistLegacyServices(inputs, [], []).services[0].integration).toEqual({
      type: "sonarr",
      config,
    });
  });
});
