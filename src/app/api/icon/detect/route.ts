import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/auth";
import { detectServiceIcon } from "@/lib/iconDetect";

// Detects a service's icon from its URL, server-side — mirrors /api/ping:
// the dashboard's own server does the outbound request (it can reach
// LAN-only hosts a browser or third-party favicon API can't).
//
// POST + JSON body (not GET + query param) is deliberate: a GET endpoint
// keyed off a query string can be triggered by a plain top-level
// navigation (a link, an auto-redirect) even with a SameSite=Lax session
// cookie, since Lax cookies still ride along on top-level GET navigations.
// A JSON POST can only be issued by same-origin script, which closes that
// CSRF path without weakening the feature itself — but only if the server
// actually requires the application/json content type. A plain HTML form
// can set Content-Type to text/plain (still a CORS-simple request, no
// preflight) with a body that happens to parse as JSON; browsers can't set
// application/json from a form, only from script, so rejecting anything
// else closes that gap.
export async function POST(request: Request) {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ icon: null, source: null, error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return NextResponse.json({ error: "Unsupported content type" }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { url: raw, name } = (body ?? {}) as { url?: unknown; name?: unknown };
  if (typeof raw !== "string" || raw === "") {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  try {
    const target = new URL(raw);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return NextResponse.json({ error: "Invalid url" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  const result = await detectServiceIcon(raw, typeof name === "string" ? name : undefined);
  return NextResponse.json(result);
}
