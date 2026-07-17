import "@/integrations";
import { NextResponse } from "next/server";
import { getConfig } from "@/config";
import { getWidget } from "@/widgets";
import { fetchWithHardTimeout, WidgetFetchTimeoutError } from "./_timeout";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const service = searchParams.get("service");

  if (!type) {
    return NextResponse.json({ ok: false, error: "Missing type parameter" }, { status: 400 });
  }
  if (!service) {
    return NextResponse.json({ ok: false, error: "Missing service parameter" }, { status: 400 });
  }

  const widget = getWidget(type);
  if (!widget) {
    return NextResponse.json(
      { ok: false, error: `Unknown widget type: "${type}"` },
      { status: 404 }
    );
  }

  // Look up config server-side from settings.yaml — credentials never travel through the client.
  const serviceEntry = getConfig().services.find((s) => s.name === service);
  if (!serviceEntry) {
    return NextResponse.json(
      { ok: false, error: `Service not found: "${service}"` },
      { status: 404 }
    );
  }
  const rawConfig: unknown = serviceEntry.widget?.config ?? {};

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
      (signal) => widget.fetchData(parsed.data, signal),
      "Widget fetch timed out"
    );
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    if (err instanceof WidgetFetchTimeoutError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 504 });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Widget fetch failed" },
      { status: 500 }
    );
  }
}
