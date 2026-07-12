import "@/integrations";
import { NextResponse } from "next/server";
import { getWidget } from "@/widgets";
import { checkAuth } from "../../_auth";

// Tests a widget connection with config straight from the (possibly unsaved)
// service form. Unlike GET /api/widget, the config arrives in the body instead
// of being looked up in settings.yaml — the service may not exist yet. This
// endpoint triggers server-side requests to caller-supplied URLs, so it is
// strictly auth-gated.
export async function POST(request: Request) {
  if (!(await checkAuth())) {
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

  const parsed = widget.configSchema.safeParse(config ?? {});
  if (!parsed.success) {
    const messages = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(", ");
    return NextResponse.json(
      { ok: false, error: `Invalid widget config: ${messages}` },
      { status: 400 }
    );
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error("Connection test timed out")), 5000);
  try {
    // Only pass/fail matters here — discard the data so credentials-derived
    // payloads never round-trip through the form.
    await widget.fetchData(parsed.data, ac.signal);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (ac.signal.aborted) {
      return NextResponse.json(
        { ok: false, error: "Connection test timed out" },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Connection test failed" },
      { status: 500 }
    );
  } finally {
    clearTimeout(timer);
  }
}
