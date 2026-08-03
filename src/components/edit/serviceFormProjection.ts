import {
  type KokpitConfig,
  type Service,
  type ServiceTile,
  widgetIntegrationRequirement,
} from "@/config/schema";
import { getWidget } from "@/widgets";
import { resolveServiceSize } from "@/config/resolve";

const OPTION_KEYS: Record<string, ReadonlySet<string>> = {
  "plex": new Set(["fields"]), "sonarr-calendar": new Set(["days"]),
  "sonarr-queue": new Set(["limit"]), "radarr-queue": new Set(["limit"]),
  "qbittorrent-torrents": new Set(["limit", "filter"]), "seerr-requests": new Set(["limit", "filter"]),
  "docker": new Set(["max_items"]), "netdata-cpu": new Set(["history_minutes"]),
  "netdata-ram": new Set(["history_minutes"]), "netdata-net": new Set(["interface", "history_minutes"]),
  "netdata-disk-io": new Set(["disk_path", "history_minutes"]), "netdata-disk-space": new Set(["chart_id"]),
  "netdata-sensor": new Set(["chart_id", "label", "history_minutes"]),
  "actualbudget-categories": new Set(["limit", "category_ids", "timezone", "hide_income", "hide_empty"]),
  "actualbudget-accounts": new Set(["account_ids", "timezone", "exclude_closed", "exclude_offbudget"]),
  "actualbudget-schedules": new Set(["days_ahead", "timezone", "limit"]),
  "actualbudget-summary": new Set(["timezone", "privacy_mode", "currency", "sections"]),
};

export function splitWidgetConfig(widgetType: string, value: unknown) {
  const config = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  if (widgetIntegrationRequirement(widgetType) === null) {
    return { connection: {}, options: config };
  }
  const declaredOptionKeys = getWidget(widgetType)?.optionFields?.map((field) => field.key);
  const optionKeys = new Set(declaredOptionKeys ?? OPTION_KEYS[widgetType] ?? []);
  const connection: Record<string, unknown> = {};
  const options: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(config)) {
    (optionKeys.has(key) ? options : connection)[key] = item;
  }
  return { connection, options };
}

/** Projects a persisted v2 service and its editable tile into ServiceForm input. */
export function toLegacyService(service: KokpitConfig["services"][number], tile?: ServiceTile): Service {
  return {
    ...service,
    url: service.launch_url,
    ...(tile?.group ? { group: tile.group } : {}),
    ...(tile?.size ? { size: tile.size } : {}),
    ...(tile?.widget ? { widget: {
      ...tile.widget,
      config: {
        ...(service.integration?.config ?? {}),
        ...(tile.widget.config ?? {}),
      },
    } } : {}),
  };
}

export function projectLegacyServices(
  services: KokpitConfig["services"],
  serviceTiles: ServiceTile[]
): Service[] {
  return services.map((service) =>
    toLegacyService(service, serviceTiles.find((tile) => tile.service_id === service.id))
  );
}

export function normalizeServicesForForm(
  services: KokpitConfig["services"],
  serviceTiles: ServiceTile[]
): Pick<KokpitConfig, "services" | "service_tiles"> {
  const normalizedServices = services.map((service) => ({
    ...service,
    id: service.id ?? crypto.randomUUID(),
  }));
  const normalizedTiles = serviceTiles.length > 0
    ? serviceTiles
    : normalizedServices.flatMap((service) => {
      const legacy = service as Service;
      return legacy.group || legacy.size || legacy.widget ? [{
        id: crypto.randomUUID(),
        service_id: service.id,
        ...(legacy.group ? { group: legacy.group } : {}),
        ...(legacy.size ? { size: legacy.size } : {}),
        ...(legacy.widget ? { widget: legacy.widget } : {}),
      }] : [];
    });
  return { services: normalizedServices, service_tiles: normalizedTiles };
}

export function persistLegacyServices(
  inputs: Service[],
  previousServices: KokpitConfig["services"],
  previousTiles: ServiceTile[]
): Pick<KokpitConfig, "services" | "service_tiles"> {
  const services: KokpitConfig["services"] = [];
  const service_tiles: ServiceTile[] = [];

  inputs.forEach((input, index) => {
    const previous = input.id
      ? previousServices.find((service) => service.id === input.id)
      : previousServices[index];
    const id = input.id ?? previous?.id ?? crypto.randomUUID();
    const primaryTile = previousTiles.find((tile) => tile.service_id === id);
    const widget = input.widget;
    const preserveUnknownWidgetConfig = Boolean(
      widget &&
      primaryTile?.widget?.type === widget.type &&
      !getWidget(widget.type)
    );
    const split = widget ? splitWidgetConfig(widget.type, widget.config) : undefined;
    const integrationType = widget ? widgetIntegrationRequirement(widget.type) : undefined;
    const integration = !widget
      ? previous?.integration
      : preserveUnknownWidgetConfig
        ? previous?.integration
        : integrationType && getWidget(widget.type)
          ? { type: integrationType, config: split!.connection }
          : undefined;

    services.push({
      id,
      name: input.name,
      ...(input.launch_url ?? input.url ? { launch_url: input.launch_url ?? input.url } : {}),
      ...(input.icon ? { icon: input.icon } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.category ?? input.group ? { category: input.category ?? input.group } : {}),
      ...(integration ? { integration } : {}),
    });

    if (!previous || primaryTile || input.group || input.size || widget) {
      service_tiles.push({
        id: primaryTile?.id ?? crypto.randomUUID(),
        service_id: id,
        ...(input.group ?? primaryTile?.group ? { group: input.group ?? primaryTile?.group } : {}),
        ...(input.size ?? (input.position ? resolveServiceSize(input) : primaryTile?.size)
          ? { size: input.size ?? (input.position ? resolveServiceSize(input) : primaryTile?.size) }
          : {}),
        ...(widget ? {
          widget: {
            ...widget,
            ...(preserveUnknownWidgetConfig
              ? { config: primaryTile?.widget?.config }
              : Object.keys(split!.options).length ? { config: split!.options } : {}),
          },
        } : primaryTile?.widget ? { widget: primaryTile.widget } : {}),
      });
    }
    service_tiles.push(...previousTiles.filter(
      (tile) => tile.service_id === id && tile.id !== primaryTile?.id
    ));
  });

  return { services, service_tiles };
}
