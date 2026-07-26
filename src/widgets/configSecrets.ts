import "@/integrations";
import {
  serviceNameUniquenessKey,
  type KokpitConfig,
  type Service,
} from "@/config/schema";
import { getWidget } from "@/widgets";
import { widgetCredentialScopesMatch } from "./credentialScope";
import {
  isWidgetSecretReference,
} from "./secretReference";
import {
  createWidgetSecretReference,
  verifyWidgetSecretReference,
} from "./secretReference.server";

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

function passwordFieldKeys(widgetType: string): string[] {
  return (
    getWidget(widgetType)
      ?.configFields?.filter((field) => field.type === "password")
      .map((field) => field.key) ?? []
  );
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

      const passwordKeys = passwordFieldKeys(widget.type);
      if (passwordKeys.length === 0) return service;

      let changed = false;
      const redactedConfig = { ...rawConfig };
      for (const key of passwordKeys) {
        if (
          !Object.prototype.hasOwnProperty.call(rawConfig, key) ||
          rawConfig[key] === undefined
        ) {
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
  if (
    !reference ||
    reference.widgetType !== expectedWidgetType ||
    reference.fieldKey !== expectedFieldKey
  ) {
    throw new WidgetSecretResolutionError(
      "widget_secret_reference_invalid"
    );
  }

  const source = savedServices.find(
    (service) =>
      serviceNameUniquenessKey(service.name) ===
      serviceNameUniquenessKey(reference.serviceName)
  );
  if (source?.widget?.type !== expectedWidgetType) {
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
  let resolvedConfig: Record<string, unknown> | null = null;
  const passwordKeys = passwordFieldKeys(widgetType);
  for (const [key, value] of Object.entries(rawConfig)) {
    if (
      isWidgetSecretReference(value) &&
      !passwordKeys.includes(key)
    ) {
      throw new WidgetSecretResolutionError(
        "widget_secret_reference_invalid"
      );
    }
  }
  for (const key of passwordKeys) {
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
