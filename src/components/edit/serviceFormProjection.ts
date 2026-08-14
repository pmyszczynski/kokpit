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
import { generateUuid } from "@/config/uuid";
import { GENERIC_SERVICE_FOOTPRINT, legacyWidgetFootprint } from "@/layout/grid";

export { splitWidgetConfig } from "@/widgets/configBoundary";

const hasOpaqueWidgetConfigReference = isWidgetConfigReferenceEnvelope;

function deriveIntegration(
  input: Service,
  previous: KokpitConfig["services"][number] | undefined,
  primaryTile: ServiceTile | undefined
) {
  if (input.editorIntegration) {
    switch (input.editorIntegration.command) {
      case "preserve":
        return { explicit: false, command: true, integration: previous?.integration };
      case "clear":
        return { explicit: true, command: true, integration: undefined };
      case "set":
        {
        const integration = input.editorIntegration;
        // Only widgets backed by a Service integration can produce this
        // editor command. In particular, dashboard-only widgets must not
        // silently become Service integrations.
        if (
          input.editorIntegration.type !== "" &&
          getWidgetsWithServiceEditorPreset().some(
            (widget) => widgetIntegrationRequirement(widget.id) === integration.type
          )
        ) {
          return {
            explicit: true,
            command: true,
            integration: {
              type: integration.type,
              config: integration.config,
            },
          };
        }
        throw new Error(`Unsupported Service integration "${integration.type}"`);
        }
    }
  }
  const hasInputWidget = Object.prototype.hasOwnProperty.call(input, "widget");
  if (!hasInputWidget) return { explicit: false, command: false, integration: previous?.integration };

  const widget = input.widget;
  if (!widget) {
    return primaryTile?.widget
      ? { explicit: true, command: false, integration: undefined }
      : { explicit: false, command: false, integration: previous?.integration };
  }

  const preserveUnknownWidgetConfig = Boolean(
    primaryTile?.widget?.type === widget.type && !getWidget(widget.type)
  );
  if (preserveUnknownWidgetConfig) {
    return { explicit: true, command: false, integration: previous?.integration };
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
        return { explicit: true, command: false, integration: previous?.integration };
      }
      return { explicit: true, command: false, integration: { type: integrationType, config: {} } };
    }
    return {
      explicit: true,
      command: false,
      integration: {
        type: integrationType,
        config: connection,
      },
    };
  }

  const preservesExistingIntegrationFreeWidget = Boolean(
    previous?.integration &&
    primaryTile?.widget?.type === widget.type &&
    getWidget(widget.type) &&
    integrationType === null
  );
  if (preservesExistingIntegrationFreeWidget) {
    return { explicit: false, command: false, integration: previous?.integration };
  }

  return { explicit: true, command: false, integration: undefined };
}

function integrationsMatch(
  left: KokpitConfig["services"][number]["integration"] | undefined,
  right: KokpitConfig["services"][number]["integration"] | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right || left.type !== right.type) return false;
  return structurallyEqual(left.config, right.config);
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => structurallyEqual(value, right[index]));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      structurallyEqual(leftRecord[key], rightRecord[key])
    );
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
  const integrationConfig = service.integration?.config;
  return {
    ...service,
    ...(tile ? { tileId: tile.id } : {}),
    ...(integrationConfig ? { editorIntegrationConfig: integrationConfig } : {}),
    ...(tileConfig ? { editorTileWidgetConfig: tileConfig } : {}),
    url: service.launch_url,
    ...(tile?.group ? { group: tile.group } : {}),
    ...(tile?.size ? { size: tile.size } : {}),
    ...(tile?.footprint ? { footprint: { ...tile.footprint } } : {}),
    ...(tile?.widget ? { widget: {
      ...tile.widget,
      // Tile options and Service credentials are separate persisted
      // boundaries. Never synthesize a merged widget config for the editor.
      ...(tileConfig ? { config: tileConfig } : {}),
    } } : {}),
    // Catalog context is a presentation fact: this Service has no tile. It
    // must not be inferred from whether it currently has an integration.
    ...(!tile ? { editorCatalogOnly: true, editorIntegration: { command: "preserve" as const } } : {}),
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
    delete persisted.editorIntegration;
    delete persisted.tileId;
    return {
      ...persisted,
      id: persisted.id ?? generateUuid(),
    };
  });
  const normalizedTiles = serviceTiles.length > 0
    ? serviceTiles
    : normalizedServices.flatMap((service) => {
      const legacy = service as Service;
      return legacy.group || legacy.size || legacy.footprint || legacy.widget ? [{
        id: generateUuid(),
        service_id: service.id,
        ...(legacy.group ? { group: legacy.group } : {}),
        ...(legacy.size ? { size: legacy.size } : {}),
        ...(legacy.footprint ? { footprint: { ...legacy.footprint } } : {}),
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
    return input.id || previous?.id ? input : { ...input, id: generateUuid() };
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
    let inferredIntegration: KokpitConfig["services"][number]["integration"] | undefined;
    let explicitCommandIntegration: KokpitConfig["services"][number]["integration"] | undefined;
    let hasExplicitInput = false;
    let hasExplicitCommand = false;

    for (const input of serviceInputs) {
      const primaryTile = input.tileId
        ? previousTiles.find((tile) => tile.id === input.tileId)
        : previousTiles.find((tile) => tile.service_id === id);
      const candidate = deriveIntegration(input, previous, primaryTile);
      if (!candidate.explicit) continue;
      if (candidate.command) {
        if (
          hasExplicitCommand &&
          !integrationsMatch(candidate.integration, explicitCommandIntegration)
        ) {
          throw new Error(`Conflicting explicit integration commands for Service "${id}"`);
        }
        hasExplicitCommand = true;
        explicitCommandIntegration = candidate.integration;
        continue;
      }
      hasExplicitInput = true;
      inferredIntegration = candidate.integration;
      if (candidate.integration) {
        if (!integrationsMatch(candidate.integration, previous?.integration)) {
          changedIntegration = candidate.integration;
        }
      }
    }

    integrationsByServiceId.set(
      id,
      hasExplicitCommand
        ? explicitCommandIntegration
        : changedIntegration ?? inferredIntegration ?? (hasExplicitInput ? undefined : previous?.integration)
    );
  });

  const handledServices = new Set<string>();
  stableInputs.forEach((input, index) => {
    const previous = input.id
      ? previousServices.find((service) => service.id === input.id)
      : previousServices[index];
    const id = input.id ?? previous?.id ?? generateUuid();
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
      widget &&
      primaryTile.widget?.type === widget.type &&
      previousTileConfig &&
      hasOpaqueWidgetConfigReference(previousTileConfig) &&
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
      const resolvedSize = hasInputSize
        ? input.size
        : input.position
          ? resolveServiceSize(input)
          : primaryTile?.size;
      const defaultFootprint = widget
        ? getWidget(widget.type)?.supportedFootprints?.[0] ?? legacyWidgetFootprint(resolvedSize)
        : resolvedSize
          ? legacyWidgetFootprint(resolvedSize)
          : GENERIC_SERVICE_FOOTPRINT;
      const sizeChanged = hasInputSize && input.size !== primaryTile?.size;
      const widgetChanged = hasInputWidget && widget?.type !== primaryTile?.widget?.type;
      const footprint = sizeChanged || widgetChanged
        ? defaultFootprint
        : input.footprint
          ? { ...input.footprint }
          : primaryTile?.footprint
            ? { ...primaryTile.footprint }
            : defaultFootprint;
      const persistedTile = {
        id: primaryTile?.id ?? input.tileId ?? generateUuid(),
        service_id: id,
        footprint,
        ...((hasInputGroup ? input.group : primaryTile?.group)
          ? { group: hasInputGroup ? input.group : primaryTile?.group }
          : {}),
        ...(resolvedSize
          ? { size: resolvedSize }
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

  const tileRequirementsByServiceId = new Map<string, Set<string>>();
  for (const tile of service_tiles) {
    if (!tile.widget) continue;
    const requirement = widgetIntegrationRequirement(tile.widget.type);
    if (!requirement) continue;
    const requirements = tileRequirementsByServiceId.get(tile.service_id) ?? new Set<string>();
    requirements.add(requirement);
    tileRequirementsByServiceId.set(tile.service_id, requirements);
  }
  for (const [serviceId, requirements] of tileRequirementsByServiceId) {
    if (requirements.size > 1) {
      throw new Error(`Conflicting tile integration requirements for Service "${serviceId}"`);
    }
    const [requiredType] = requirements;
    if (servicesById.get(serviceId)?.integration?.type !== requiredType) {
      throw new Error(
        `Service "${serviceId}" integration must match its ${requiredType} tile`
      );
    }
  }

  if (options.preserveUnrepresentedCatalogServices) {
    const representedServiceIds = new Set(service_tiles.map((tile) => tile.service_id));
    for (const service of previousServices) {
      if (!servicesById.has(service.id) && !representedServiceIds.has(service.id)) {
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
