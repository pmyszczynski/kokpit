export type WidgetFetchOperation = "load" | "connection-test";

/**
 * Returns only bounded application-owned text. Integration errors may contain
 * upstream response bodies, request URLs, headers, or saved credentials.
 */
export function publicWidgetFetchError(
  operation: WidgetFetchOperation
): string {
  return operation === "load"
    ? "Widget fetch failed"
    : "Connection test failed";
}
