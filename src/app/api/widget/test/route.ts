import "@/integrations";
import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/auth";
import { getConfig } from "@/config";
import { getWidget } from "@/widgets";
import { fetchWithHardTimeout, WidgetFetchTimeoutError } from "@/lib/fetchTimeout";
import {
  resolveIntegrationConfigSecrets,
  resolveWidgetConfigSecrets,
  WidgetSecretResolutionError,
} from "@/widgets/configSecrets";
import { publicWidgetFetchError } from "@/widgets/publicFetchError";
import { legacyIntegrationType } from "@/config/loader";

// Tests a widget connection with config straight from the (possibly unsaved)
// service form. Unlike GET /api/widget, the config arrives in the body instead
// of being looked up in settings.yaml — the service may not exist yet. This
// endpoint triggers server-side requests to caller-supplied URLs, so it is
// strictly auth-gated.
export async function POST(request: Request) {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { type, config } = (body ?? {}) as { type?: unknown; config?: unknown };
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

  let resolvedConfig: unknown;
  try {
    const savedServices = getConfig().services;
    resolvedConfig = savedServices.some((service) => service.integration)
      ? resolveIntegrationConfigSecrets(
          legacyIntegrationType(type),
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
    return NextResponse.json(
      { ok: false, error: publicWidgetFetchError("connection-test") },
      { status: 500 }
    );
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
      (signal) => widget.fetchData(parsed.data, signal),
      "Connection test timed out",
      widget.fetchTimeoutMs
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof WidgetFetchTimeoutError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 504 });
    }
    return NextResponse.json(
      { ok: false, error: publicWidgetFetchError("connection-test") },
      { status: 500 }
    );
  }
}
