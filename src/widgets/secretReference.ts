export const WIDGET_SECRET_REFERENCE_PREFIX =
  "__KOKPIT_WIDGET_SECRET_REF__:";

export interface WidgetSecretReference {
  serviceName: string;
  widgetType: string;
  fieldKey: string;
}

/**
 * Opaque browser-safe marker for a secret that remains in settings.yaml.
 * The marker contains only the non-secret location needed to find the value
 * again server-side; it never contains or derives from the secret itself.
 */
export function createWidgetSecretReference(
  serviceName: string,
  widgetType: string,
  fieldKey: string
): string {
  return `${WIDGET_SECRET_REFERENCE_PREFIX}${JSON.stringify([
    serviceName,
    widgetType,
    fieldKey,
  ])}`;
}

/** True for the reserved placeholder namespace, including malformed tokens. */
export function isWidgetSecretReference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(WIDGET_SECRET_REFERENCE_PREFIX)
  );
}

export function parseWidgetSecretReference(
  value: unknown
): WidgetSecretReference | null {
  if (!isWidgetSecretReference(value)) return null;

  try {
    const parsed: unknown = JSON.parse(
      value.slice(WIDGET_SECRET_REFERENCE_PREFIX.length)
    );
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 3 ||
      !parsed.every((part) => typeof part === "string" && part.length > 0)
    ) {
      return null;
    }
    return {
      serviceName: parsed[0],
      widgetType: parsed[1],
      fieldKey: parsed[2],
    };
  } catch {
    return null;
  }
}
