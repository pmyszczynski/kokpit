import { NextResponse } from "next/server";
import { getWidget } from "@/widgets";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const configParam = searchParams.get("config");

  if (!type) {
    return NextResponse.json({ ok: false, error: "Missing type parameter" }, { status: 400 });
  }

  const widget = getWidget(type);
  if (!widget) {
    return NextResponse.json(
      { ok: false, error: `Unknown widget type: "${type}"` },
      { status: 404 }
    );
  }

  let rawConfig: unknown = {};
  if (configParam) {
    try {
      rawConfig = JSON.parse(atob(configParam)) as unknown;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid config parameter" },
        { status: 400 }
      );
    }
  }

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
    const data = await Promise.race([
      widget.fetchData(parsed.data),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Widget fetch timed out")), 5000)
      ),
    ]);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Widget fetch failed" },
      { status: 500 }
    );
  }
}
