import { MULTIPART_ALLOWANCE_BYTES, readBoundedFormData, RequestBodyError } from "@/lib/requestBody";
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

  let form: FormData;
  try {
    form = await readBoundedFormData(request, MAX_ICON_UPLOAD_BYTES + MULTIPART_ALLOWANCE_BYTES);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyError && error.status === 413
        ? "File exceeds the 2 MB limit" : "Expected multipart/form-data" },
      { status: error instanceof RequestBodyError ? error.status : 400 }
    );
  }
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    if (!(await isRequestAuthenticated())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
