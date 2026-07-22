// Server-only: validation and hash-addressed storage for user-uploaded
// dashboard backgrounds. A profile binding over ./uploads. Backgrounds are
// full-viewport raster images, so the cap is larger than icons (8 MB) and the
// allowlist is png/jpg/webp only — SVG is intentionally omitted here: a
// full-page SVG background is an unusual, higher-risk surface, and raster covers
// every real background use.
import {
  processUpload,
  readUpload,
  storeUpload,
  type ProcessedUpload,
  type StoredUpload,
  type UploadProfile,
} from "./uploads";

export const MAX_BACKGROUND_UPLOAD_BYTES = 8 * 1024 * 1024;

const BACKGROUND_PROFILE: UploadProfile = {
  subdir: "backgrounds",
  maxBytes: MAX_BACKGROUND_UPLOAD_BYTES,
  maxLabel: "8 MB",
  allow: new Set(["png", "jpg", "webp"]),
  typesLabel: "PNG, JPG, or WebP",
};

/**
 * Validates an uploaded background and returns the bytes to store. Enforces the
 * 8 MB cap and png/jpg/webp allowlist, sniffing raster magic bytes. Throws
 * UploadError (with an HTTP status) on rejection.
 */
export function processBackgroundUpload(input: {
  bytes: Uint8Array;
  declaredType: string;
  filename: string;
}): ProcessedUpload {
  return processUpload(BACKGROUND_PROFILE, input);
}

/** Writes the processed background and returns its `<hash>.<ext>` filename. */
export function storeBackgroundUpload(bg: ProcessedUpload): Promise<string> {
  return storeUpload(BACKGROUND_PROFILE, bg);
}

/** Reads a stored background back, or null if the name is malformed or missing. */
export function readBackgroundUpload(filename: string): Promise<StoredUpload | null> {
  return readUpload(BACKGROUND_PROFILE, filename);
}
