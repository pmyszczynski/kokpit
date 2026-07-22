import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/auth";
import { readBackgroundUpload } from "@/lib/backgroundUploads";

// Serves a stored user-uploaded background. Auth-guarded like the rest of the
// app; the browser sends the session cookie on the CSS background request, so an
// authenticated dashboard loads these fine while an unauthenticated caller can't
// enumerate them.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { file } = await params;
  const stored = await readBackgroundUpload(file);
  if (!stored) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Backgrounds are raster-only (png/jpg/webp), but keep the same locked-down
  // serve posture as icons: nosniff so the browser won't reinterpret the type,
  // and a restrictive CSP as defense in depth.
  return new NextResponse(new Uint8Array(stored.bytes), {
    status: 200,
    headers: {
      "Content-Type": stored.contentType,
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
