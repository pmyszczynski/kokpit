import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/auth";
import { detectServiceIcon } from "@/lib/iconDetect";

// Detects a service's icon from its URL, server-side — mirrors /api/ping:
// the dashboard's own server does the outbound request (it can reach
// LAN-only hosts a browser or third-party favicon API can't), and the
// endpoint is strictly auth-gated since it fetches caller-supplied URLs.
export async function GET(request: Request) {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ icon: null, source: null, error: "Unauthorized" }, { status: 401 });
  }

  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  try {
    const target = new URL(raw);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return NextResponse.json({ error: "Invalid url parameter" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid url parameter" }, { status: 400 });
  }

  const result = await detectServiceIcon(raw);
  return NextResponse.json(result);
}
