export const WIDGET_SECRET_REFERENCE_PREFIX =
  "__KOKPIT_WIDGET_SECRET_REF__:";

/**
 * Whole-config placeholder used when a widget type is no longer registered.
 * Its contents are intentionally opaque to the browser: without registry
 * metadata there is no safe way to decide which individual keys are secrets.
 */
export const WIDGET_CONFIG_REFERENCE_PREFIX =
  "__KOKPIT_WIDGET_CONFIG_REF__:";

/** True for the reserved placeholder namespace, including malformed tokens. */
export function isWidgetSecretReference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(WIDGET_SECRET_REFERENCE_PREFIX)
  );
}

/** True for the reserved opaque-config namespace, including malformed tokens. */
export function isWidgetConfigReference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(WIDGET_CONFIG_REFERENCE_PREFIX)
  );
}
