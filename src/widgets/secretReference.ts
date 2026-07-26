export const WIDGET_SECRET_REFERENCE_PREFIX =
  "__KOKPIT_WIDGET_SECRET_REF__:";

/** True for the reserved placeholder namespace, including malformed tokens. */
export function isWidgetSecretReference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(WIDGET_SECRET_REFERENCE_PREFIX)
  );
}
