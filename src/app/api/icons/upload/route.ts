import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/auth";
import {
  IconUploadError,
  MAX_ICON_UPLOAD_BYTES,
  processIconUpload,
  storeIconUpload,
} from "@/lib/iconUploads";

// Accepts a single user-uploaded icon (multipart/form-data, field `file`),
// validates + sanitizes it, stores it hash-addressed in the persisted uploads
// volume, and returns the path the icon field should be set to.
export async function POST(request: Request) {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Reject an oversized body up front from the Content-Length header, before
  // buffering the multipart body into memory. The 1024-byte allowance covers
  // multipart boundary/field overhead around the actual file bytes; the
  // post-buffer check below (against the real decoded file size) remains the
  // authoritative cap.
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? NaN : Number(contentLengthHeader);
  if (Number.isFinite(contentLength) && contentLength > MAX_ICON_UPLOAD_BYTES + 1024) {
    return NextResponse.json({ error: "File exceeds the 2 MB limit" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }
  // Cheap pre-check before buffering; the byte-length cap is re-enforced after
  // reading, since File.size is client-reported.
  if (file.size > MAX_ICON_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File exceeds the 2 MB limit" }, { status: 413 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const processed = processIconUpload({
      bytes,
      declaredType: file.type,
      filename: file.name,
    });
    const filename = await storeIconUpload(processed);
    return NextResponse.json({ path: `/api/icons/user/${filename}` });
  } catch (err) {
    if (err instanceof IconUploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
