/** Actual streamed-body limits; declared lengths are only an early rejection. */
export const AUTH_JSON_BODY_BYTES = 16 * 1024;
export const ICON_DETECTION_BODY_BYTES = 64 * 1024;
export const WIDGET_TEST_BODY_BYTES = 256 * 1024;
export const SETTINGS_BODY_BYTES = 2 * 1024 * 1024;
export const MULTIPART_ALLOWANCE_BYTES = 64 * 1024;

/** A public-safe body error, containing neither submitted data nor read errors. */
export class RequestBodyError extends Error {
  constructor(message: string, readonly status: 400 | 413) {
    super(message);
    this.name = "RequestBodyError";
  }
}

/** Read once, stopping at the real byte boundary even without Content-Length. */
export async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > limit) {
    void request.body?.cancel().catch(() => {});
    throw new RequestBodyError("Request body too large", 413);
  }
  if (request.signal.aborted) throw new RequestBodyError("Invalid request body", 400);
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    if (!request.body) return new Uint8Array(0);
    reader = request.body.getReader();
  } catch {
    throw new RequestBodyError("Invalid request body", 400);
  }
  // Retain one bounded buffer rather than an unbounded list of tiny chunks.
  // Grow only as data arrives so idle or small requests do not reserve the cap.
  let bytes = new Uint8Array(0);
  let total = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  request.signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (request.signal.aborted) throw new RequestBodyError("Invalid request body", 400);
      if (done) break;
      if (value.byteLength > limit - total) {
        cancel();
        throw new RequestBodyError("Request body too large", 413);
      }
      const required = total + value.byteLength;
      if (required > bytes.byteLength) {
        const capacity = Math.min(limit, Math.max(required, bytes.byteLength * 2, 1024));
        const grown = new Uint8Array(capacity);
        grown.set(bytes.subarray(0, total));
        bytes = grown;
      }
      bytes.set(value, total);
      total = required;
    }
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    cancel();
    throw new RequestBodyError("Invalid request body", 400);
  } finally {
    request.signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  return bytes.subarray(0, total);
}

/** Parse a bounded JSON object before endpoint-specific field/schema checks. */
export async function readJsonObject(request: Request, limit: number): Promise<Record<string, unknown>> {
  const bytes = await readBoundedBody(request, limit);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestBodyError("Invalid JSON", 400);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RequestBodyError("Invalid request body", 400);
  }
  return value as Record<string, unknown>;
}

/** Bound the entire multipart envelope before invoking the platform parser. */
export async function readBoundedFormData(request: Request, limit: number): Promise<FormData> {
  const bytes = await readBoundedBody(request, limit);
  try {
    return await new Response(bytes, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    throw new RequestBodyError("Expected multipart/form-data", 400);
  }
}
