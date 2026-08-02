import "@/integrations";
import {
  type KokpitConfig,
  type Service,
} from "@/config/schema";
import type {
  ClientSafeService,
  ClientSafeSettings,
} from "./clientSafeSettings";
import { getIntegration, getWidget } from "@/widgets";
import { integrationCredentialScopesMatch, widgetCredentialScopesMatch } from "./credentialScope";
import {
  isWidgetSecretReference,
} from "./secretReference";
import {
  createWidgetConfigReference,
  createWidgetSecretReference,
  verifyWidgetConfigReference,
  verifyWidgetSecretReference,
  widgetConfigReferenceMatches,
  widgetSecretReferenceMatches,
} from "./secretReference.server";

/** The sole browser-visible key for an opaque unknown-widget config. */
export const UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY =
  "__kokpit_widget_config_reference__";

export type WidgetSecretResolutionErrorCode =
  | "widget_secret_reference_invalid"
  | "widget_secret_scope_changed";

const ERROR_MESSAGES: Record<WidgetSecretResolutionErrorCode, string> = {
  widget_secret_reference_invalid:
    "Saved widget credential is no longer available. Re-enter the credential.",
  widget_secret_scope_changed:
    "Widget credential scope changed. Re-enter the credential.",
};

export class WidgetSecretResolutionError extends Error {
  readonly code: WidgetSecretResolutionErrorCode;

  constructor(code: WidgetSecretResolutionErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "WidgetSecretResolutionError";
    this.code = code;
  }
}

function credentialFieldKeys(widgetType: string): string[] {
  return (
    getWidget(widgetType)
      ?.configFields?.filter((field) => field.type === "password")
      .map((field) => field.key) ?? []
  );
}

function isSafeConfigValue(
  type: "text" | "url" | "password" | "number" | "multiselect" | "boolean",
  value: unknown
): boolean {
  if (value === undefined) return true;
  if (type === "text" || type === "url" || type === "password") {
    return typeof value === "string";
  }
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (type === "boolean") return typeof value === "boolean";
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function getOpaqueConfigReference(
  config: Record<string, unknown>
): unknown | null {
  const keys = Object.keys(config);
  if (keys.length !== 1 || keys[0] !== UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY) {
    return null;
  }
  return config[UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY];
}

/**
 * Returns a browser-safe config copy. Password fields are identified only by
 * registry metadata, so integrations do not need key-name redaction lists.
 */
export function toClientSafeSettings(config: KokpitConfig): ClientSafeSettings {
  return {
    schema_version: config.schema_version,
    auth: { enabled: config.auth.enabled, session_ttl_hours: config.auth.session_ttl_hours },
    appearance: {
      theme: config.appearance.theme,
      custom_css: config.appearance.custom_css,
      card_blur: config.appearance.card_blur,
      background: config.appearance.background ? { ...config.appearance.background } : undefined,
    },
    layout: {
      columns: config.layout.columns,
      row_height: config.layout.row_height,
      ungrouped: config.layout.ungrouped,
      tablet: config.layout.tablet ? { ...config.layout.tablet } : undefined,
      mobile: config.layout.mobile ? { ...config.layout.mobile } : undefined,
    },
    groups: config.groups?.map((group) => ({ ...group })),
    bookmarks: config.bookmarks?.map((group) => ({
      ...group,
      placement: group.placement ? { ...group.placement } : undefined,
      links: group.links.map((link) => ({ ...link })),
    })),
    service_tiles: (config.service_tiles ?? []).map((tile) => ({
      id: tile.id,
      service_id: tile.service_id,
      group: tile.group,
      size: tile.size,
      widget: tile.widget
        ? {
            ...tile.widget,
            fields: tile.widget.fields ? [...tile.widget.fields] : undefined,
            config: tile.widget.config ? { ...tile.widget.config } : undefined,
          }
        : undefined,
    })),
    services: config.services.map((service): ClientSafeService => {
      if (!service.integration) {
        // Schema v1 reaches this helper only in KOK-57 compatibility tests;
        // production configuration is validated as v2 before this boundary.
        const legacy = service as Service;
        if (!legacy.widget?.config) return {
          id: service.id!, name: service.name, launch_url: service.launch_url,
          icon: service.icon, description: service.description, category: service.category,
        };
        const raw = legacy.widget.config;
        const definition = getWidget(legacy.widget.type);
        const fields = new Map([...(definition?.configFields ?? []), ...(definition?.preservedConfigFields ?? [])].map((field) => [field.key, field] as const));
        const hideWhole = !definition || Object.entries(raw).some(([key, value]) => {
          const field = fields.get(key);
          return !field || !isSafeConfigValue(field.type, value);
        });
        const safeConfig: Record<string, unknown> = hideWhole
          ? { [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]: createWidgetConfigReference(legacy.name, legacy.widget.type) }
          : { ...raw };
        if (!hideWhole) for (const key of credentialFieldKeys(legacy.widget.type)) {
          if (raw[key] !== undefined && raw[key] !== "") safeConfig[key] = createWidgetSecretReference(legacy.name, legacy.widget.type, key);
        }
        return {
          id: legacy.id!, name: legacy.name, launch_url: legacy.launch_url,
          icon: legacy.icon, description: legacy.description, category: legacy.category,
          widget: { type: legacy.widget.type, fields: legacy.widget.fields, refresh_interval_ms: legacy.widget.refresh_interval_ms, config: safeConfig },
        } as ClientSafeService;
      }
      const rawConfig = service.integration.config;
      const integration = getIntegration(service.integration.type);
      const widgets = config.service_tiles
        .filter((tile) => tile.service_id === service.id && tile.widget)
        .map((tile) => getWidget(tile.widget!.type))
        .filter((widget) => widget != null);
      const declaredFields = new Map(
        (integration?.connectionFields ?? widgets.flatMap((widget) => [
          ...(widget.configFields ?? []),
          ...(widget.preservedConfigFields ?? []),
        ])).map((field) => [field.key, field] as const)
      );
      const hideWholeConfig =
        (!integration && widgets.length === 0) ||
        Object.entries(rawConfig).some(([key, value]) => {
          const field = declaredFields.get(key);
          return !field || !isSafeConfigValue(field.type, value);
        });
      if (hideWholeConfig) {
        return {
          id: service.id, name: service.name, launch_url: service.launch_url,
          icon: service.icon, description: service.description, category: service.category,
          integration: {
            ...service.integration,
            config: {
              [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]:
                createWidgetConfigReference(service.id, service.integration.type),
            },
          },
        };
      }
      const safeConfig = { ...rawConfig };
      for (const field of declaredFields.values()) {
        if (field.type !== "password") continue;
        const value = rawConfig[field.key];
        if (value === undefined || value === "") continue;
        safeConfig[field.key] = createWidgetSecretReference(
          service.id,
          service.integration.type,
          field.key
        );
      }
      return {
        id: service.id, name: service.name, launch_url: service.launch_url,
        icon: service.icon, description: service.description, category: service.category,
        integration: { ...service.integration, config: safeConfig },
      };
    }),
  };
}

function resolveReference(
  referenceValue: unknown,
  expectedWidgetType: string,
  expectedFieldKey: string,
  destinationConfig: Record<string, unknown>,
  savedServices: Service[]
): unknown {
  const reference = verifyWidgetSecretReference(referenceValue);
  if (!reference) {
    throw new WidgetSecretResolutionError(
      "widget_secret_reference_invalid"
    );
  }

  const source = savedServices.find((service) =>
    service.widget?.type === expectedWidgetType &&
    widgetSecretReferenceMatches(
      reference,
      service.name,
      expectedWidgetType,
      expectedFieldKey
    )
  );
  if (!source?.widget) {
    throw new WidgetSecretResolutionError(
      "widget_secret_reference_invalid"
    );
  }

  const sourceConfig = source.widget.config;
  if (
    !sourceConfig ||
    !Object.prototype.hasOwnProperty.call(sourceConfig, expectedFieldKey)
  ) {
    throw new WidgetSecretResolutionError(
      "widget_secret_reference_invalid"
    );
  }
  const savedValue = sourceConfig[expectedFieldKey];
  if (
    typeof savedValue !== "string" ||
    isWidgetSecretReference(savedValue)
  ) {
    throw new WidgetSecretResolutionError(
      "widget_secret_reference_invalid"
    );
  }
  if (
    !widgetCredentialScopesMatch(
      expectedWidgetType,
      sourceConfig,
      destinationConfig
    )
  ) {
    throw new WidgetSecretResolutionError("widget_secret_scope_changed");
  }
  return savedValue;
}

function resolveUnknownWidgetConfig(
  widgetType: string,
  config: Record<string, unknown>,
  savedServices: Service[]
): Record<string, unknown> {
  const opaqueReference = getOpaqueConfigReference(config);
  if (opaqueReference === null) {
    if (Object.prototype.hasOwnProperty.call(config, UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY)) {
      throw new WidgetSecretResolutionError(
        "widget_secret_reference_invalid"
      );
    }
    return config;
  }

  return resolveOpaqueWidgetConfigReference(
    widgetType,
    opaqueReference,
    savedServices
  );
}

function resolveOpaqueWidgetConfigReference(
  widgetType: string,
  opaqueReference: unknown,
  savedServices: Service[]
): Record<string, unknown> {
  const reference = verifyWidgetConfigReference(opaqueReference);
  if (!reference) {
    throw new WidgetSecretResolutionError("widget_secret_reference_invalid");
  }
  const source = savedServices.find(
    (service) =>
      service.widget?.config !== undefined &&
      service.widget.type === widgetType &&
      widgetConfigReferenceMatches(reference, service.name, widgetType)
  );
  if (!source?.widget?.config) {
    throw new WidgetSecretResolutionError("widget_secret_reference_invalid");
  }
  return source.widget.config;
}

/**
 * Resolves placeholders in one submitted widget config against the live
 * server-side config. Used by connection testing before schema validation.
 */
export function resolveWidgetConfigSecrets(
  widgetType: string,
  config: unknown,
  savedServices: Service[]
): unknown {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return config;
  }

  const rawConfig = config as Record<string, unknown>;
  const opaqueReference = getOpaqueConfigReference(rawConfig);
  if (opaqueReference !== null) {
    return resolveUnknownWidgetConfig(widgetType, rawConfig, savedServices);
  }
  if (Object.prototype.hasOwnProperty.call(rawConfig, UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY)) {
    const replacementConfig = { ...rawConfig };
    const replacementReference = replacementConfig[
      UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY
    ];
    delete replacementConfig[UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY];
    resolveOpaqueWidgetConfigReference(
      widgetType,
      replacementReference,
      savedServices
    );
    return resolveWidgetConfigSecrets(
      widgetType,
      replacementConfig,
      savedServices
    );
  }
  if (!getWidget(widgetType)) {
    return resolveUnknownWidgetConfig(widgetType, rawConfig, savedServices);
  }
  let resolvedConfig: Record<string, unknown> | null = null;
  const credentialKeys = credentialFieldKeys(widgetType);
  for (const [key, value] of Object.entries(rawConfig)) {
    if (
      isWidgetSecretReference(value) &&
      !credentialKeys.includes(key)
    ) {
      throw new WidgetSecretResolutionError(
        "widget_secret_reference_invalid"
      );
    }
  }
  for (const key of credentialKeys) {
    const value = rawConfig[key];
    if (!isWidgetSecretReference(value)) continue;
    resolvedConfig ??= { ...rawConfig };
    resolvedConfig[key] = resolveReference(
      value,
      widgetType,
      key,
      rawConfig,
      savedServices
    );
  }
  return resolvedConfig ?? config;
}

/**
 * Resolves all submitted service placeholders before YAML persistence. Each
 * token points to its original service name, so rename and reorder operations
 * can happen together without relying on array position.
 */
export function resolveServiceWidgetSecrets(
  submittedServices: Service[],
  savedServices: Service[]
): Service[] {
  return submittedServices.map((service) => {
    const widget = service.widget;
    if (!widget?.config) return service;
    const resolved = resolveWidgetConfigSecrets(
      widget.type,
      widget.config,
      savedServices
    );
    if (resolved === widget.config) return service;
    return {
      ...service,
      widget: {
        ...widget,
        config: resolved as Record<string, unknown>,
      },
    };
  });
}

/** Resolve schema-v2 Service integration references by immutable Service ID. */
export function resolveServiceIntegrationSecrets(
  submitted: KokpitConfig["services"],
  saved: KokpitConfig["services"]
): KokpitConfig["services"] {
  return submitted.map((service) => {
    if (!service.integration) return service;
    const incoming = service.integration.config;
    const opaque = getOpaqueConfigReference(incoming);
    if (opaque !== null) {
      const reference = verifyWidgetConfigReference(opaque);
      const source = saved.find((candidate) => candidate.integration && widgetConfigReferenceMatches(reference!, candidate.id, candidate.integration.type));
      if (!reference || !source?.integration) throw new WidgetSecretResolutionError("widget_secret_reference_invalid");
      return { ...service, integration: { ...service.integration, config: source.integration.config } };
    }
    const source = saved.find((candidate) => candidate.id === service.id && candidate.integration?.type === service.integration!.type);
    const resolved = { ...incoming };
    if (typeof resolved.url === "string") {
      try { resolved.url = new URL(resolved.url.trim()).toString(); } catch { /* schema reports invalid URLs */ }
    }
    for (const [key, value] of Object.entries(incoming)) {
      if (!isWidgetSecretReference(value)) continue;
      const reference = verifyWidgetSecretReference(value);
      if (!reference || !source?.integration || !widgetSecretReferenceMatches(reference, service.id, service.integration.type, key)) throw new WidgetSecretResolutionError("widget_secret_reference_invalid");
      if (!Object.prototype.hasOwnProperty.call(source.integration.config, key)) throw new WidgetSecretResolutionError("widget_secret_reference_invalid");
      if (!integrationCredentialScopesMatch(service.integration.type, source.integration.config, resolved)) {
        throw new WidgetSecretResolutionError("widget_secret_scope_changed");
      }
      resolved[key] = source.integration.config[key];
    }
    return { ...service, integration: { ...service.integration, config: resolved } };
  });
}

/** Resolve a connection-test payload without requiring the browser to choose a Service. */
export function resolveIntegrationConfigSecrets(
  integrationType: string,
  config: Record<string, unknown>,
  saved: KokpitConfig["services"]
): Record<string, unknown> {
  const resolved = { ...config };
  if (typeof resolved.url === "string") {
    try { resolved.url = new URL(resolved.url.trim()).toString(); } catch { /* validated later */ }
  }
  for (const [key, value] of Object.entries(config)) {
    if (!isWidgetSecretReference(value)) continue;
    const reference = verifyWidgetSecretReference(value);
    const source = reference && saved.find((candidate) =>
      candidate.integration?.type === integrationType &&
      widgetSecretReferenceMatches(reference, candidate.id, integrationType, key)
    );
    if (!source?.integration || !Object.prototype.hasOwnProperty.call(source.integration.config, key)) {
      throw new WidgetSecretResolutionError("widget_secret_reference_invalid");
    }
    if (!integrationCredentialScopesMatch(integrationType, source.integration.config, resolved)) {
      throw new WidgetSecretResolutionError("widget_secret_scope_changed");
    }
    resolved[key] = source.integration.config[key];
  }
  return resolved;
}
