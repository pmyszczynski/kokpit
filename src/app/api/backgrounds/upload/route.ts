import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/auth";
import {
  MAX_BACKGROUND_UPLOAD_BYTES,
  processBackgroundUpload,
  storeBackgroundUpload,
} from "@/lib/backgroundUploads";
import { UploadError } from "@/lib/uploads";

// Accepts a single user-uploaded background (multipart/form-data, field `file`),
// validates it, stores it hash-addressed in the persisted uploads volume, and
// returns the path the background image field should be set to.
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
  if (Number.isFinite(contentLength) && contentLength > MAX_BACKGROUND_UPLOAD_BYTES + 1024) {
    return NextResponse.json({ error: "File exceeds the 8 MB limit" }, { status: 413 });
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
  if (file.size > MAX_BACKGROUND_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File exceeds the 8 MB limit" }, { status: 413 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const processed = processBackgroundUpload({
      bytes,
      declaredType: file.type,
      filename: file.name,
    });
    const filename = await storeBackgroundUpload(processed);
    return NextResponse.json({ path: `/api/backgrounds/user/${filename}` });
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
