import { describe, expect, it } from "vitest";
import {
  persistLegacyServices,
  projectLegacyServices,
  splitWidgetConfig,
} from "@/components/edit/serviceFormProjection";
import { UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY, resolveServiceIntegrationSecrets } from "@/widgets/configSecrets";
import { createWidgetConfigReference } from "@/widgets/secretReference.server";

const serviceId = "10000000-0000-4000-8000-000000000001";
const tileId = "20000000-0000-4000-8000-000000000001";
const extraTileId = "20000000-0000-4000-8000-000000000002";

describe("serviceFormProjection", () => {
  it("merges connection and tile options for editing, then preserves their boundary and extra tiles", () => {
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
    expect(input.widget?.config).toEqual({ url: "http://sonarr.local", api_key: "widget-secret-ref.sonarr", days: 14 });

    const persisted = persistLegacyServices([{ ...input, name: "Sonarr renamed" }], services, service_tiles);
    expect(persisted.services[0]).toMatchObject({ id: serviceId, integration: { config: { url: "http://sonarr.local", api_key: "widget-secret-ref.sonarr" } } });
    expect(persisted.service_tiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: tileId, widget: { type: "sonarr-calendar", config: { days: 14 } } }),
      expect.objectContaining({ id: extraTileId }),
    ]));
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
    expect(persisted.service_tiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: tileId, widget: expect.objectContaining({ config: { layout: "compact" }, refresh_interval_ms: 60_000 }) }),
      expect.objectContaining({ id: extraTileId, widget: expect.objectContaining({ config: { layout: "secondary" } }) }),
    ]));
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
});
