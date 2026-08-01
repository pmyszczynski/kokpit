import "@/integrations";
import {
  type KokpitConfig,
  type Service,
} from "@/config/schema";
import { getWidget } from "@/widgets";
import { widgetCredentialScopesMatch } from "./credentialScope";
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

function shouldHideWholeConfig(
  widgetType: string,
  config: Record<string, unknown>
): boolean {
  const widget = getWidget(widgetType);
  if (!widget) return Object.keys(config).length > 0;

  const fields = new Map(
    [...(widget.configFields ?? []), ...(widget.preservedConfigFields ?? [])].map(
      (field) => [field.key, field] as const
    )
  );
  return Object.entries(config).some(([key, value]) => {
    const field = fields.get(key);
    return !field || !isSafeConfigValue(field.type, value);
  });
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
export function redactWidgetSecrets(config: KokpitConfig): KokpitConfig {
  return {
    ...config,
    services: config.services.map((service) => {
      const widget = service.widget;
      const rawConfig = widget?.config;
      if (!widget || !rawConfig) return service;

      // Unknown keys and malformed declared values could contain secrets.
      // Keep the complete config on the server in those cases.
      if (shouldHideWholeConfig(widget.type, rawConfig)) {
        return {
          ...service,
          widget: {
            ...widget,
            config: {
              [UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY]:
                createWidgetConfigReference(service.name, widget.type),
            },
          },
        };
      }

      const credentialKeys = credentialFieldKeys(widget.type);
      if (credentialKeys.length === 0) return service;

      let changed = false;
      const redactedConfig = { ...rawConfig };
      for (const key of credentialKeys) {
        const value = rawConfig[key];
        if (value === undefined || value === "") {
          continue;
        }
        redactedConfig[key] = createWidgetSecretReference(
          service.name,
          widget.type,
          key
        );
        changed = true;
      }
      if (!changed) return service;

      return {
        ...service,
        widget: { ...widget, config: redactedConfig },
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
