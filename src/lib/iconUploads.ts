// Server-only: validation, SVG sanitization, and hash-addressed storage for
// user-uploaded tile icons. A thin profile binding over ./uploads (the generic
// core) — the icons contract (2 MB cap, png/jpg/webp/svg, `data/uploads/icons/`)
// is unchanged; only the implementation is now shared with other upload kinds.
import {
  processUpload,
  readUpload,
  storeUpload,
  UPLOAD_FILENAME_PATTERN,
  UploadError,
  sanitizeSvg,
  type ProcessedUpload,
  type StoredUpload,
  type UploadProfile,
} from "./uploads";

export const MAX_ICON_UPLOAD_BYTES = 2 * 1024 * 1024;

// Re-exported so the existing icons routes/tests keep their imports and the
// error identity (`err instanceof IconUploadError`, `.toThrow(IconUploadError)`)
// works — it's the same class the generic core throws.
export { UploadError as IconUploadError, sanitizeSvg };
export const ICON_FILENAME_PATTERN = UPLOAD_FILENAME_PATTERN;
export type ProcessedIcon = ProcessedUpload;
export type StoredIcon = StoredUpload;

// Exported so the upload GC (src/lib/uploadGc.ts) can prune this profile's dir
// without redefining the profile — single source of truth for the icons
// contract (subdir, cap, allowlist).
export const ICON_PROFILE: UploadProfile = {
  subdir: "icons",
  maxBytes: MAX_ICON_UPLOAD_BYTES,
  maxLabel: "2 MB",
  allow: new Set(["png", "jpg", "webp", "svg"]),
  typesLabel: "PNG, JPG, WebP, or SVG",
};

/**
 * Validates an uploaded icon and returns the bytes to store. Enforces the size
 * cap and the png/jpg/webp/svg allowlist, sniffs raster magic bytes, and
 * sanitizes SVGs. Throws IconUploadError (with an HTTP status) on rejection.
 */
export function processIconUpload(input: {
  bytes: Uint8Array;
  declaredType: string;
  filename: string;
}): ProcessedIcon {
  return processUpload(ICON_PROFILE, input);
}

/** Writes the processed icon and returns its `<hash>.<ext>` filename. */
export function storeIconUpload(icon: ProcessedIcon): Promise<string> {
  return storeUpload(ICON_PROFILE, icon);
}

/** Reads a stored icon back, or null if the name is malformed or missing. */
export function readIconUpload(filename: string): Promise<StoredIcon | null> {
  return readUpload(ICON_PROFILE, filename);
}
