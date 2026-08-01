import { getWidget, type WidgetConfigField } from "./index";

function normalizeScopeValue(
  field: WidgetConfigField,
  value: unknown
): string | null {
  if (typeof value !== "string") return null;
  if (field.type !== "url") return field.type === "text" ? value : null;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Calculates a browser-safe credential destination scope from registry
 * metadata. Missing or invalid values fail closed.
 */
export function normalizeCredentialScope(
  widgetType: string,
  config: unknown
): string[] | null {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    return null;
  }
  const widget = getWidget(widgetType);
  const scopeFields = widget?.credentialScopeFields;
  if (!widget || !scopeFields || scopeFields.length === 0) return null;

  const rawConfig = config as Record<string, unknown>;
  const normalized: string[] = [];
  for (const key of scopeFields) {
    const field = widget.configFields?.find((candidate) => candidate.key === key);
    if (!field) return null;
    const value = normalizeScopeValue(field, rawConfig[key]);
    if (value === null) return null;
    normalized.push(value);
  }
  return normalized;
}

export function widgetCredentialScopesMatch(
  widgetType: string,
  sourceConfig: unknown,
  destinationConfig: unknown
): boolean {
  const source = normalizeCredentialScope(widgetType, sourceConfig);
  const destination = normalizeCredentialScope(widgetType, destinationConfig);
  return (
    source !== null &&
    destination !== null &&
    source.length === destination.length &&
    source.every((value, index) => value === destination[index])
  );
}
