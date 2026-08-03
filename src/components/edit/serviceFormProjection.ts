import {
  type KokpitConfig,
  type Service,
  type ServiceTile,
  widgetIntegrationRequirement,
} from "@/config/schema";
import { getWidget, getWidgetsWithServiceEditorPreset } from "@/widgets";
import { splitWidgetConfig } from "@/widgets/configBoundary";
import { isWidgetConfigReferenceEnvelope } from "@/widgets/secretReference";
import { resolveServiceSize } from "@/config/resolve";

export { splitWidgetConfig } from "@/widgets/configBoundary";

const hasOpaqueWidgetConfigReference = isWidgetConfigReferenceEnvelope;

function deriveIntegration(
  input: Service,
  previous: KokpitConfig["services"][number] | undefined,
  primaryTile: ServiceTile | undefined
) {
  const hasInputWidget = Object.prototype.hasOwnProperty.call(input, "widget");
  if (!hasInputWidget) return { explicit: false, integration: previous?.integration };

  const widget = input.widget;
  if (!widget) {
    return primaryTile?.widget
      ? { explicit: true, integration: undefined }
      : { explicit: false, integration: previous?.integration };
  }

  const preserveUnknownWidgetConfig = Boolean(
    primaryTile?.widget?.type === widget.type && !getWidget(widget.type)
  );
  if (preserveUnknownWidgetConfig) {
    return { explicit: true, integration: previous?.integration };
  }

  const integrationType = widgetIntegrationRequirement(widget.type);
  if (integrationType && getWidget(widget.type)) {
    const primaryRequirement = primaryTile?.widget
      ? widgetIntegrationRequirement(primaryTile.widget.type)
      : null;
    const preservePreviousIntegration = (
      previous?.integration?.type === integrationType &&
      (!primaryTile?.widget || primaryRequirement === integrationType)
    );
    const connection = splitWidgetConfig(widget.type, widget.config).connection;
    if (Object.keys(connection).length === 0) {
      if (preservePreviousIntegration) {
        return { explicit: true, integration: previous?.integration };
      }
      return { explicit: true, integration: { type: integrationType, config: {} } };
    }
    return {
      explicit: true,
      integration: {
        type: integrationType,
        config: connection,
      },
    };
  }

  return { explicit: true, integration: undefined };
}

function integrationsMatch(
  left: KokpitConfig["services"][number]["integration"] | undefined,
  right: KokpitConfig["services"][number]["integration"] | undefined
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasPresentationChange(
  input: Service,
  previous: KokpitConfig["services"][number] | undefined
): boolean {
  if (!previous) return true;
  return input.name !== previous.name ||
    (input.url ?? input.launch_url) !== previous.launch_url ||
    input.icon !== previous.icon ||
    input.description !== previous.description ||
    (Object.prototype.hasOwnProperty.call(input, "category") && input.category !== previous.category);
}

/** Projects a persisted v2 service and its editable tile into ServiceForm input. */
export function toLegacyService(service: KokpitConfig["services"][number], tile?: ServiceTile): Service {
  const tileConfig = tile?.widget?.config;
  const opaqueTileConfig = tileConfig && hasOpaqueWidgetConfigReference(tileConfig);
  const integrationConfig = service.integration?.config;
  const opaqueIntegrationConfig = integrationConfig && hasOpaqueWidgetConfigReference(integrationConfig);
  const catalogWidget = !tile && service.integration
    ? getWidgetsWithServiceEditorPreset()
        .filter((widget) => widgetIntegrationRequirement(widget.id) === service.integration!.type)
        .sort((left, right) =>
          (left.configFields?.length ?? 0) - (right.configFields?.length ?? 0) ||
          left.id.localeCompare(right.id)
        )[0]
    : undefined;
  return {
    ...service,
    ...(tile ? { tileId: tile.id } : {}),
    ...(integrationConfig ? { editorIntegrationConfig: integrationConfig } : {}),
    ...(tileConfig ? { editorTileWidgetConfig: tileConfig } : {}),
    url: service.launch_url,
    ...(tile?.group ? { group: tile.group } : {}),
    ...(tile?.size ? { size: tile.size } : {}),
    ...(tile?.widget ? { widget: {
      ...tile.widget,
      config: {
        ...(opaqueIntegrationConfig ? {} : integrationConfig ?? {}),
        ...(opaqueTileConfig ? {} : tileConfig ?? {}),
      },
    } } : catalogWidget ? {
      editorCatalogOnly: true,
      widget: {
        type: catalogWidget.id,
        config: opaqueIntegrationConfig ? {} : integrationConfig ?? {},
      },
    } : {}),
  };
}

export function projectLegacyServices(
  services: KokpitConfig["services"],
  serviceTiles: ServiceTile[]
): Service[] {
  const servicesById = new Map(services.map((service) => [service.id, service]));
  return serviceTiles.flatMap((tile) => {
    const service = servicesById.get(tile.service_id);
    return service ? [toLegacyService(service, tile)] : [];
  });
}

/** Projects tiles first, then catalog-only services for the Settings form. */
export function projectCatalogServices(
  services: KokpitConfig["services"],
  serviceTiles: ServiceTile[]
): Service[] {
  const representedServiceIds = new Set(serviceTiles.map((tile) => tile.service_id));
  return [
    ...projectLegacyServices(services, serviceTiles),
    ...services
      .filter((service) => !representedServiceIds.has(service.id))
      .map((service) => toLegacyService(service)),
  ];
}

export function normalizeServicesForForm(
  services: KokpitConfig["services"],
  serviceTiles: ServiceTile[]
): Pick<KokpitConfig, "services" | "service_tiles"> {
  const normalizedServices = services.map((service) => {
    const persisted = { ...service } as Service;
    delete persisted.editorIntegrationConfig;
    delete persisted.editorTileWidgetConfig;
    delete persisted.tileId;
    return {
      ...persisted,
      id: persisted.id ?? crypto.randomUUID(),
    };
  });
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
  previousTiles: ServiceTile[],
  options: {
    preservePreviousServiceOrder?: boolean;
    preserveUnrepresentedCatalogServices?: boolean;
  } = {}
): Pick<KokpitConfig, "services" | "service_tiles"> {
  const stableInputs = inputs.map((input, index) => {
    const previous = input.id
      ? previousServices.find((service) => service.id === input.id)
      : previousServices[index];
    return input.id || previous?.id ? input : { ...input, id: crypto.randomUUID() };
  });
  const servicesById = new Map<string, KokpitConfig["services"][number]>();
  const service_tiles: ServiceTile[] = [];

  const integrationsByServiceId = new Map<string, KokpitConfig["services"][number]["integration"] | undefined>();
  const canonicalInputsByServiceId = new Map<string, Service>();
  const inputsByServiceId = new Map<string, Service[]>();
  const inputServiceIds: string[] = [];
  stableInputs.forEach((input, index) => {
    const previous = input.id
      ? previousServices.find((service) => service.id === input.id)
      : previousServices[index];
    const id = input.id ?? previous?.id;
    if (!id) return;
    if (!canonicalInputsByServiceId.has(id) || hasPresentationChange(input, previous)) {
      canonicalInputsByServiceId.set(id, input);
    }
    const serviceInputs = inputsByServiceId.get(id) ?? [];
    if (serviceInputs.length === 0) inputServiceIds.push(id);
    serviceInputs.push(input);
    inputsByServiceId.set(id, serviceInputs);
  });

  inputsByServiceId.forEach((serviceInputs, id) => {
    const previous = previousServices.find((service) => service.id === id);
    let changedIntegration: KokpitConfig["services"][number]["integration"] | undefined;
    let requiredIntegration: KokpitConfig["services"][number]["integration"] | undefined;
    let hasExplicitInput = false;

    for (const input of serviceInputs) {
      const primaryTile = input.tileId
        ? previousTiles.find((tile) => tile.id === input.tileId)
        : previousTiles.find((tile) => tile.service_id === id);
      const candidate = deriveIntegration(input, previous, primaryTile);
      if (!candidate.explicit) continue;
      hasExplicitInput = true;
      if (candidate.integration) {
        requiredIntegration = candidate.integration;
        if (!integrationsMatch(candidate.integration, previous?.integration)) {
          changedIntegration = candidate.integration;
        }
      }
    }

    integrationsByServiceId.set(
      id,
      changedIntegration ?? requiredIntegration ?? (hasExplicitInput ? undefined : previous?.integration)
    );
  });

  const handledServices = new Set<string>();
  stableInputs.forEach((input, index) => {
    const previous = input.id
      ? previousServices.find((service) => service.id === input.id)
      : previousServices[index];
    const id = input.id ?? previous?.id ?? crypto.randomUUID();
    const primaryTile = input.tileId
      ? previousTiles.find((tile) => tile.id === input.tileId)
      : previousTiles.find((tile) => tile.service_id === id);
    const hasInputGroup = Object.prototype.hasOwnProperty.call(input, "group");
    const hasInputSize = Object.prototype.hasOwnProperty.call(input, "size");
    const hasInputWidget = Object.prototype.hasOwnProperty.call(input, "widget");
    const widget = input.widget;
    const hasWidgetTileMutation = hasInputWidget && Boolean(widget || primaryTile?.widget);
    const hasDefinedPlacement =
      (hasInputGroup && input.group !== undefined) ||
      (hasInputSize && input.size !== undefined) ||
      Boolean(input.position);
    const preserveUnknownWidgetConfig = Boolean(
      widget &&
      primaryTile?.widget?.type === widget.type &&
      !getWidget(widget.type)
    );
    const split = widget ? splitWidgetConfig(widget.type, widget.config) : undefined;
    const previousTileConfig = input.editorTileWidgetConfig ?? primaryTile?.widget?.config;
    const preserveOpaqueTileConfig = Boolean(
      primaryTile &&
      previousTileConfig &&
      hasOpaqueWidgetConfigReference(previousTileConfig) &&
      widget &&
      Object.keys(split!.options).length === 0
    );
    const integration = integrationsByServiceId.get(id);

    if (!handledServices.has(id)) {
      handledServices.add(id);
      const canonical = canonicalInputsByServiceId.get(id) ?? input;
      const category = Object.prototype.hasOwnProperty.call(canonical, "category")
        ? canonical.category
        : previous?.category;
      servicesById.set(id, {
      id,
      name: canonical.name,
      ...(canonical.url ?? canonical.launch_url ? { launch_url: canonical.url ?? canonical.launch_url } : {}),
      ...(canonical.icon ? { icon: canonical.icon } : {}),
      ...(canonical.description ? { description: canonical.description } : {}),
      ...(category ?? (!previous ? canonical.group : undefined) ? {
        category: category ?? (!previous ? canonical.group : undefined),
      } : {}),
      ...(integration ? { integration } : {}),
      });
    }

    if (!input.editorCatalogOnly && (!previous || input.tileId || primaryTile || hasDefinedPlacement || hasWidgetTileMutation)) {
      const persistedTile = {
        id: primaryTile?.id ?? input.tileId ?? crypto.randomUUID(),
        service_id: id,
        ...((hasInputGroup ? input.group : primaryTile?.group)
          ? { group: hasInputGroup ? input.group : primaryTile?.group }
          : {}),
        ...((hasInputSize
          ? input.size
          : input.position ? resolveServiceSize(input) : primaryTile?.size)
          ? { size: hasInputSize ? input.size : (input.position ? resolveServiceSize(input) : primaryTile?.size) }
          : {}),
        ...(hasInputWidget && widget ? {
          widget: {
            ...widget,
            ...(preserveUnknownWidgetConfig
              ? { config: primaryTile?.widget?.config }
              : preserveOpaqueTileConfig
                ? { config: previousTileConfig }
              : Object.keys(split!.options).length ? { config: split!.options } : {}),
          },
        } : !hasInputWidget && primaryTile?.widget ? { widget: primaryTile.widget } : {}),
      };
      service_tiles.push(persistedTile);
    }
  });

  if (options.preserveUnrepresentedCatalogServices) {
    for (const service of previousServices) {
      if (!servicesById.has(service.id) && !previousTiles.some((tile) => tile.service_id === service.id)) {
        servicesById.set(service.id, service);
      }
    }
  }

  const services = options.preservePreviousServiceOrder
    ? [
      ...previousServices.flatMap((service) => {
        const updated = servicesById.get(service.id);
        return updated ? [updated] : [];
      }),
      ...[...servicesById.entries()]
        .filter(([id]) => !previousServices.some((service) => service.id === id))
        .map(([, service]) => service),
    ]
    : [
      ...inputServiceIds.flatMap((id) => {
        const service = servicesById.get(id);
        return service ? [service] : [];
      }),
      ...[...servicesById.entries()]
        .filter(([id]) => !inputServiceIds.includes(id))
        .map(([, service]) => service),
    ];

  return { services, service_tiles };
}
