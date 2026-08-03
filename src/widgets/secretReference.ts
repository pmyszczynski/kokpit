export const WIDGET_SECRET_REFERENCE_PREFIX =
  "__KOKPIT_WIDGET_SECRET_REF__:";

/**
 * Browser-visible wrapper for a signed field reference. Keeping the signed
 * token inside an object means a user-provided password can never be mistaken
 * for a placeholder merely because it starts with a reserved string prefix.
 */
export const WIDGET_SECRET_REFERENCE_KEY =
  "__kokpit_widget_secret_reference__";

export type WidgetSecretReferencePlaceholder = {
  [WIDGET_SECRET_REFERENCE_KEY]: string;
};

/**
 * Whole-config placeholder used when a widget type is no longer registered.
 * Its contents are intentionally opaque to the browser: without registry
 * metadata there is no safe way to decide which individual keys are secrets.
 */
export const WIDGET_CONFIG_REFERENCE_PREFIX =
  "__KOKPIT_WIDGET_CONFIG_REF__:";

/** True for an exact field-reference envelope, including malformed tokens. */
export function isWidgetSecretReference(
  value: unknown
): value is WidgetSecretReferencePlaceholder {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 1 &&
    typeof record[WIDGET_SECRET_REFERENCE_KEY] === "string" &&
    record[WIDGET_SECRET_REFERENCE_KEY].startsWith(
      WIDGET_SECRET_REFERENCE_PREFIX
    )
  );
}

/** True for the reserved opaque-config namespace, including malformed tokens. */
export function isWidgetConfigReference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(WIDGET_CONFIG_REFERENCE_PREFIX)
  );
}

/** True only for the browser-safe whole-config envelope. */
export function isWidgetConfigReferenceEnvelope(
  value: unknown,
  key = "__kokpit_widget_config_reference__"
): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && isWidgetConfigReference(record[key]);
}
