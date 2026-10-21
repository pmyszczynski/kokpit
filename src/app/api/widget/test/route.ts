import { WIDGET_TEST_BODY_BYTES, readJsonObject, RequestBodyError } from "@/lib/requestBody";
import "@/integrations";
import { NextResponse } from "next/server";
import { isAuthenticationEnabled, isRequestAuthenticated } from "@/auth";
import { getConfigSnapshot, legacyIntegrationType } from "@/config/server";
import type { KokpitConfig } from "@/config/schema";
import { getWidget } from "@/widgets";
import { isTileFootprint } from "@/layout/grid";
import { fetchWithHardTimeout, WidgetFetchTimeoutError } from "@/lib/fetchTimeout";
import {
  resolveIntegrationConfigSecrets,
  resolveWidgetConfigSecrets,
  WidgetSecretResolutionError,
} from "@/widgets/configSecrets";
import {
  widgetFetchFailure,
  widgetFetchTimeoutFailure,
} from "@/widgets/publicFetchError";

/** Require current protected configuration before parsing or using credentials. */
async function connectionTestConfig(): Promise<{ config: KokpitConfig } | { response: NextResponse }> {
  const snapshot = getConfigSnapshot();
  if (
    !(await isRequestAuthenticated(
      snapshot.state === "dirty" ? undefined : snapshot.config ?? undefined
    ))
  ) {
    return { response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }
  if (snapshot.state === "dirty" || !snapshot.config) {
    return { response: NextResponse.json(
      {
        ok: false,
        error: "settings.yaml is being updated; retry once the change is complete",
        code: "config_unavailable",
      },
      { status: 409 }
    ) };
  }
  if (!isAuthenticationEnabled(snapshot.config)) {
    return { response: NextResponse.json({ ok: false, error: "Connection tests require authentication" }, { status: 403 }) };
  }
  return { config: snapshot.config };
}

// Tests a widget connection with config straight from the (possibly unsaved)
// service form. Unlike GET /api/widget, the config arrives in the body instead
// of being looked up in settings.yaml — the service may not exist yet. This
// endpoint triggers server-side requests to caller-supplied URLs, so it is
// strictly auth-gated.
export async function POST(request: Request) {
  const initial = await connectionTestConfig();
  if ("response" in initial) return initial.response;

  let body: unknown;
  try {
    body = await readJsonObject(request, WIDGET_TEST_BODY_BYTES);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof RequestBodyError ? error.message : "Invalid JSON" },
      { status: error instanceof RequestBodyError ? error.status : 400 });
  }

  // Reading a streamed body yields. A revoked session or an intervening config
  // change must not authorize outbound work or resolve stale saved credentials.
  const current = await connectionTestConfig();
  if ("response" in current) return current.response;
  const activeConfig = current.config;

  const { type, config, footprint } = (body ?? {}) as { type?: unknown; config?: unknown; footprint?: unknown };
  if (typeof type !== "string" || type === "") {
    return NextResponse.json({ ok: false, error: "Missing type" }, { status: 400 });
  }

  const widget = getWidget(type);
  if (!widget) {
    return NextResponse.json(
      { ok: false, error: `Unknown widget type: "${type}"` },
      { status: 404 }
    );
  }

  if (footprint !== undefined && (!isTileFootprint(footprint) ||
    (widget.supportedFootprints?.length && !widget.supportedFootprints.some(candidate =>
      candidate.columnSpan === footprint.columnSpan && candidate.rowSpan === footprint.rowSpan)))) {
    return NextResponse.json({ ok: false, error: "Invalid widget footprint" }, { status: 400 });
  }

  let resolvedConfig: unknown;
  try {
    const savedServices = activeConfig.services;
    const integrationType = legacyIntegrationType(type);
    resolvedConfig = integrationType && savedServices.some((service) => service.integration)
      ? resolveIntegrationConfigSecrets(
          integrationType,
          (config ?? {}) as Record<string, unknown>,
          savedServices
        )
      : resolveWidgetConfigSecrets(type, config ?? {}, savedServices);
  } catch (error) {
    if (error instanceof WidgetSecretResolutionError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: 400 }
      );
    }
    const failure = widgetFetchFailure("connection-test", type, error);
    return NextResponse.json({ ok: false, ...failure.body }, { status: failure.status });
  }

  const parsed = widget.configSchema.safeParse(resolvedConfig);
  if (!parsed.success) {
    const messages = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(", ");
    return NextResponse.json(
      { ok: false, error: `Invalid widget config: ${messages}` },
      { status: 400 }
    );
  }

  try {
    // Only pass/fail matters here — discard the data so credentials-derived
    // payloads never round-trip through the form.
    await fetchWithHardTimeout(
      (signal) => footprint === undefined
        ? widget.fetchData(parsed.data, signal)
        : widget.fetchData(parsed.data, signal, { footprint }),
      "Connection test timed out",
      widget.fetchTimeoutMs
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof WidgetFetchTimeoutError) {
      const failure = widgetFetchTimeoutFailure("connection-test", type);
      return NextResponse.json({ ok: false, ...failure.body }, { status: failure.status });
    }
    const failure = widgetFetchFailure("connection-test", type, err);
    return NextResponse.json({ ok: false, ...failure.body }, { status: failure.status });
  }
}
