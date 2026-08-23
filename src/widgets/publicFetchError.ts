export type WidgetFetchOperation = "load" | "connection-test";

export type WidgetFetchErrorCode =
  | "widget_upstream_auth_failed"
  | "widget_upstream_access_blocked"
  | "widget_upstream_session_failed"
  | "widget_upstream_unreachable"
  | "widget_upstream_error"
  | "widget_invalid_json"
  | "widget_invalid_response"
  | "widget_timeout"
  | "widget_internal_error";

type WidgetFetchDiagnostic = {
  integration: string;
  stage: string;
  upstreamStatus?: number;
  retryable: boolean;
};

export type PublicWidgetFetchError = {
  error: string;
  code: WidgetFetchErrorCode;
  retryable: boolean;
  incidentId: string;
};

export type WidgetFetchFailure = {
  status: 500 | 502 | 504;
  body: PublicWidgetFetchError;
};

const WIDGET_FETCH_ERROR_MESSAGES: Record<WidgetFetchErrorCode, string> = {
  widget_upstream_auth_failed: "The integration rejected the configured credentials.",
  widget_upstream_access_blocked:
    "The integration blocked access. Check its access controls or temporary bans.",
  widget_upstream_session_failed: "The integration did not establish a session.",
  widget_upstream_unreachable: "The integration could not be reached.",
  widget_upstream_error: "The integration returned an unexpected response.",
  widget_invalid_json: "The integration returned invalid JSON.",
  widget_invalid_response: "The integration returned invalid data.",
  widget_timeout: "",
  widget_internal_error: "",
};

function publicMessage(code: WidgetFetchErrorCode, operation: WidgetFetchOperation): string {
  if (code === "widget_timeout") {
    return operation === "load" ? "Widget fetch timed out" : "Connection test timed out";
  }
  if (code === "widget_internal_error") {
    return operation === "load" ? "Widget fetch failed" : "Connection test failed";
  }
  return WIDGET_FETCH_ERROR_MESSAGES[code];
}

/**
 * An integration-owned error. Its fields are deliberately restricted to
 * bounded diagnostic metadata, so routes can log it without inspecting a raw
 * upstream error that may contain credentials or URLs.
 */
export class WidgetFetchError extends Error {
  constructor(
    public readonly code: Exclude<WidgetFetchErrorCode, "widget_timeout" | "widget_internal_error">,
    public readonly diagnostic: WidgetFetchDiagnostic
  ) {
    super("Widget integration failure");
    this.name = "WidgetFetchError";
  }
}

type IntegrationWidgetFetchErrorCode = Exclude<
  WidgetFetchErrorCode,
  "widget_timeout" | "widget_internal_error"
>;

const INTEGRATION_ERROR_CODES = new Set<IntegrationWidgetFetchErrorCode>([
  "widget_upstream_auth_failed",
  "widget_upstream_access_blocked",
  "widget_upstream_session_failed",
  "widget_upstream_unreachable",
  "widget_upstream_error",
  "widget_invalid_json",
  "widget_invalid_response",
]);

function isIntegrationErrorCode(value: unknown): value is IntegrationWidgetFetchErrorCode {
  return typeof value === "string" && INTEGRATION_ERROR_CODES.has(value as IntegrationWidgetFetchErrorCode);
}

function incidentId(): string {
  return `wgt_${crypto.randomUUID()}`;
}

function timeoutDiagnostic(): WidgetFetchDiagnostic {
  return { integration: "unknown", stage: "timeout", retryable: true };
}

function internalDiagnostic(): WidgetFetchDiagnostic {
  return { integration: "unknown", stage: "internal", retryable: false };
}

function boundedLogToken(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(value)
    ? value
    : "unknown";
}

function boundedUpstreamStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

/**
 * Creates the public response and emits exactly one log record containing
 * only controlled metadata. Do not add the caught error to this log call.
 */
export function widgetFetchFailure(
  operation: WidgetFetchOperation,
  widgetType: string,
  error: unknown
): WidgetFetchFailure {
  const typedError =
    error instanceof WidgetFetchError && isIntegrationErrorCode(error.code)
      ? error
      : undefined;
  const code: WidgetFetchErrorCode = typedError?.code ?? "widget_internal_error";
  const diagnostic = typedError?.diagnostic ?? internalDiagnostic();
  const id = incidentId();
  const upstreamStatus = boundedUpstreamStatus(diagnostic.upstreamStatus);

  console.error({
    incidentId: id,
    widgetType: boundedLogToken(widgetType),
    operation,
    code,
    retryable: diagnostic.retryable === true,
    integration: boundedLogToken(diagnostic.integration),
    stage: boundedLogToken(diagnostic.stage),
    ...(upstreamStatus === undefined ? {} : { upstreamStatus }),
  });

  return {
    status: typedError ? 502 : 500,
    body: {
      error: publicMessage(code, operation),
      code,
      retryable: diagnostic.retryable === true,
      incidentId: id,
    },
  };
}

export function widgetFetchTimeoutFailure(
  operation: WidgetFetchOperation,
  widgetType: string
): WidgetFetchFailure {
  const id = incidentId();
  const diagnostic = timeoutDiagnostic();
  const code = "widget_timeout" as const;

  console.error({
    incidentId: id,
    widgetType: boundedLogToken(widgetType),
    operation,
    code,
    retryable: diagnostic.retryable,
    integration: diagnostic.integration,
    stage: diagnostic.stage,
  });

  return {
    status: 504,
    body: {
      error: publicMessage(code, operation),
      code,
      retryable: diagnostic.retryable,
      incidentId: id,
    },
  };
}
