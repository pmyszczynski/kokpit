import "@/integrations";
import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/auth";
import { getConfig, legacyIntegrationType } from "@/config/server";
import { getIntegration, getWidget } from "@/widgets";
import { publicWidgetFetchError } from "@/widgets/publicFetchError";
import { fetchWithHardTimeout, WidgetFetchTimeoutError } from "@/lib/fetchTimeout";

export async function GET(request: Request) {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tileId = searchParams.get("tile_id");
  const widgetType = searchParams.get("widget_type");

  if (!tileId) return NextResponse.json({ ok: false, error: "Missing tile_id parameter" }, { status: 400 });
  const config = getConfig();
  const tile = config.service_tiles.find((candidate) => candidate.id === tileId);
  if (!tile) return NextResponse.json({ ok: false, error: `ServiceTile not found: "${tileId}"` }, { status: 404 });
  if (!tile.widget) return NextResponse.json({ ok: false, error: "ServiceTile has no widget" }, { status: 400 });
  if (widgetType && tile.widget.type !== widgetType) {
    return NextResponse.json({ ok: false, error: "Widget type changed" }, { status: 409 });
  }
  const service = config.services.find((candidate) => candidate.id === tile.service_id);
  if (!service) return NextResponse.json({ ok: false, error: `Service not found for tile "${tileId}"` }, { status: 400 });
  const type = tile.widget.type;

  const widget = getWidget(type);
  if (!widget) {
    return NextResponse.json(
      { ok: false, error: `Unknown widget type: "${type}"` },
      { status: 404 }
    );
  }

  const requiredIntegration = widget.integrationType === undefined ? legacyIntegrationType(type) : widget.integrationType;
  if (requiredIntegration !== null && (!service.integration || service.integration.type !== requiredIntegration)) return NextResponse.json(
    { ok: false, error: `Widget "${type}" requires integration "${requiredIntegration}"` }, { status: 400 }
  );
  const connection = service.integration?.config ?? {};
  const options = tile.widget.config ?? {};
  const conflictingKey = Object.keys(options).find((key) =>
    Object.prototype.hasOwnProperty.call(connection, key)
  );
  if (conflictingKey) return NextResponse.json(
    { ok: false, error: `Tile option "${conflictingKey}" conflicts with integration configuration` },
    { status: 400 }
  );
  const integration = requiredIntegration ? getIntegration(requiredIntegration) : undefined;
  const parsedConnection = integration?.connectionSchema.safeParse(connection);
  if (parsedConnection && !parsedConnection.success) return NextResponse.json({ ok: false, error: `Invalid integration config: ${parsedConnection.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}` }, { status: 400 });
  const parsedOptions = widget.optionsSchema?.safeParse(options);
  if (parsedOptions && !parsedOptions.success) return NextResponse.json({ ok: false, error: `Invalid widget options: ${parsedOptions.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}` }, { status: 400 });
  const rawConfig: unknown = { ...connection, ...options };

  const parsed = widget.configSchema.safeParse(rawConfig);
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
    const data = await fetchWithHardTimeout(
      (signal) => widget.optionsSchema
        ? (widget.fetchData as unknown as (connection: unknown, options: unknown, signal?: AbortSignal) => Promise<unknown>)(parsedConnection?.data ?? connection, parsedOptions?.data ?? options, signal)
        : widget.fetchData(parsed.data, signal),
      "Widget fetch timed out",
      widget.fetchTimeoutMs
    );
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    if (err instanceof WidgetFetchTimeoutError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 504 });
    }
    return NextResponse.json(
      { ok: false, error: publicWidgetFetchError("load") },
      { status: 500 }
    );
  }
}
