import { NextResponse } from "next/server";
import { getConfig } from "@/config";
import { getWidget } from "@/widgets";

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
  const rawConfig: unknown = serviceEntry?.widget?.config ?? {};

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

  // Use an AbortController so the timeout actually cancels the widget's fetch, not just the race.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("Widget fetch timed out")), 5000);
  try {
    const data = await widget.fetchData(parsed.data, ac.signal);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Widget fetch failed" },
      { status: 500 }
    );
  } finally {
    clearTimeout(timer);
  }
}
