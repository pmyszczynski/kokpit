import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/auth";
import { readIconUpload } from "@/lib/iconUploads";

// Serves a stored user-uploaded icon. Auth-guarded like the rest of the app;
// the browser sends the session cookie on the <img> request, so an
// authenticated dashboard loads these fine while an unauthenticated caller
// can't enumerate them.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { file } = await params;
  const stored = await readIconUpload(file);
  if (!stored) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Defense in depth for SVGs: the bytes are already DOMPurify-sanitized on
  // upload, but a locked-down CSP + nosniff means that even if this file is
  // opened as a top-level document it can neither run inline script nor pull
  // any external resource, and the browser won't reinterpret the type.
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
