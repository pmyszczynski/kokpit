import { widgetIntegrationRequirement } from "@/config/schema";
import { getWidget, type AnyWidgetDefinition, type WidgetConfigField } from "./index";

const LEGACY_OPTION_KEYS: Record<string, ReadonlySet<string>> = {
  plex: new Set(["fields"]),
  "sonarr-calendar": new Set(["days"]),
  "sonarr-queue": new Set(["limit"]),
  "radarr-queue": new Set(["limit"]),
  "qbittorrent-torrents": new Set(["limit", "filter"]),
  "seerr-requests": new Set(["limit", "filter"]),
  docker: new Set(["max_items"]),
  "netdata-cpu": new Set(["history_minutes"]),
  "netdata-ram": new Set(["history_minutes"]),
  "netdata-net": new Set(["interface", "history_minutes"]),
  "netdata-disk-io": new Set(["disk_path", "history_minutes"]),
  "netdata-disk-space": new Set(["chart_id"]),
  "netdata-sensor": new Set(["chart_id", "label", "history_minutes"]),
  "actualbudget-categories": new Set([
    "limit", "category_ids", "timezone", "hide_income", "hide_empty",
  ]),
  "actualbudget-accounts": new Set([
    "account_ids", "timezone", "exclude_closed", "exclude_offbudget",
  ]),
  "actualbudget-schedules": new Set(["days_ahead", "timezone", "limit"]),
  "actualbudget-summary": new Set([
    "timezone", "privacy_mode", "currency", "sections",
  ]),
  "tautulli-activity": new Set(["sections"]),
};

const OPAQUE_CONFIG_REFERENCE_KEY = "__kokpit_widget_config_reference__";

export function widgetOptionKeys(widgetType: string): ReadonlySet<string> {
  const declared = getWidget(widgetType)?.optionFields?.map((field) => field.key);
  return new Set(declared ?? LEGACY_OPTION_KEYS[widgetType] ?? []);
}

export function splitWidgetConfig(widgetType: string, value: unknown) {
  const config = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  if (Object.prototype.hasOwnProperty.call(config, OPAQUE_CONFIG_REFERENCE_KEY)) {
    return { connection: {}, options: config };
  }
  if (widgetIntegrationRequirement(widgetType) === null) {
    return { connection: {}, options: config };
  }
  const optionKeys = widgetOptionKeys(widgetType);
  const connection: Record<string, unknown> = {};
  const options: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(config)) {
    (optionKeys.has(key) ? options : connection)[key] = item;
  }
  return { connection, options };
}

function configuredPlaceholder(field: WidgetConfigField): unknown {
  if (field.defaultValue !== undefined) return field.defaultValue;
  if (field.type === "url") return "http://saved.invalid";
  if (field.type === "number") return 1;
  if (field.type === "boolean") return false;
  if (field.type === "multiselect") {
    return field.options?.[0] ? [field.options[0].value] : [];
  }
  return "saved-configuration";
}

/**
 * Builds a validation-only merged config for an opaque saved connection.
 * Hidden connection values become harmless type-correct placeholders while
 * browser-visible tile options stay untouched and therefore remain validated.
 */
export function configForOpaqueConnectionValidation(
  definition: AnyWidgetDefinition,
  tileConfig: Record<string, unknown>
): Record<string, unknown> {
  const optionKeys = widgetOptionKeys(definition.id);
  const validationConfig = { ...tileConfig };
  for (const field of definition.configFields ?? []) {
    if (
      optionKeys.has(field.key) ||
      !field.required ||
      validationConfig[field.key] !== undefined
    ) {
      continue;
    }
    validationConfig[field.key] = configuredPlaceholder(field);
  }
  return validationConfig;
}
