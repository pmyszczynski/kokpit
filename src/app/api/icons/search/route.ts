import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/auth";
import { searchIconLibraries } from "@/lib/iconLibraries";

// Browses the CDN-backed icon libraries (dashboard-icons, selfh.st, Simple
// Icons) for the service-editor icon picker. GET is fine here — unlike
// /api/icon/detect it triggers no outbound request to a caller-supplied host
// (only the fixed, cached library indices), so there's no SSRF/CSRF surface
// to protect beyond the session check.
export async function GET(request: Request) {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query === "") {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await searchIconLibraries(query);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "Icon search failed" }, { status: 502 });
  }
}
