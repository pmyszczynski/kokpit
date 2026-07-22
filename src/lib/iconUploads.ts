// Server-only: validation, SVG sanitization, and hash-addressed storage for
// user-uploaded tile icons. Uploads land in the persisted, gitignored `data/`
// volume (not build-baked `public/`, which isn't writable in the standalone
// Docker output), served back by the /api/icons/user/[file] route.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";

export const MAX_ICON_UPLOAD_BYTES = 2 * 1024 * 1024;

// Canonical extension → served Content-Type. jpeg is normalized to jpg so a
// single canonical extension owns each stored file.
const EXT_CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/svg": "svg",
};

// Stored filenames are `<hex hash>.<ext>` — the only shape the serve route
// will read back. Anchored + character-restricted so a request path can't
// escape the uploads directory.
export const ICON_FILENAME_PATTERN = /^[a-f0-9]{16,64}\.(png|jpg|webp|svg)$/;

/** Thrown for a rejected upload; `status` is the HTTP code the route returns. */
export class IconUploadError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "IconUploadError";
    this.status = status;
  }
}

function uploadsIconDir(): string {
  const base =
    process.env.KOKPIT_UPLOADS_PATH ?? path.join(process.cwd(), "data", "uploads");
  return path.join(base, "icons");
}

// DOM-less server-side DOMPurify: a single jsdom window backs the sanitizer for
// the whole process. Hand-rolled regex stripping is a known-broken approach for
// SVG XSS, so this delegates to DOMPurify's SVG profile, which removes
// <script>, on* handlers, and javascript: URIs (and here, <foreignObject>,
// which can smuggle HTML into an SVG document).
const purifyWindow = new JSDOM("").window;
const DOMPurify = createDOMPurify(purifyWindow as unknown as Window & typeof globalThis);

export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject", "script"],
  });
}

// Content sniffing: confirms the bytes actually are the raster format they
// claim, so a mislabeled HTML/script payload can't be stored under an image
// extension and later served with an image Content-Type.
function sniffRaster(bytes: Uint8Array): "png" | "jpg" | "webp" | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return "webp";
  }
  return null;
}

function extFromInput(declaredType: string, filename: string): string | null {
  const mimeExt = MIME_TO_EXT[declaredType.split(";", 1)[0]?.trim().toLowerCase() ?? ""];
  if (mimeExt) return mimeExt;
  const raw = path.extname(filename).slice(1).toLowerCase();
  if (raw === "jpeg") return "jpg";
  return raw in EXT_CONTENT_TYPE ? raw : null;
}

export interface ProcessedIcon {
  ext: string;
  bytes: Buffer;
}

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
  if (input.bytes.length === 0) {
    throw new IconUploadError("Empty file");
  }
  if (input.bytes.length > MAX_ICON_UPLOAD_BYTES) {
    throw new IconUploadError("File exceeds the 2 MB limit", 413);
  }

  const ext = extFromInput(input.declaredType, input.filename);
  if (!ext) {
    throw new IconUploadError("Unsupported file type — use PNG, JPG, WebP, or SVG", 415);
  }

  if (ext === "svg") {
    const source = Buffer.from(input.bytes).toString("utf-8");
    const sanitized = sanitizeSvg(source);
    if (!sanitized.toLowerCase().includes("<svg")) {
      throw new IconUploadError("File is not a valid SVG");
    }
    return { ext: "svg", bytes: Buffer.from(sanitized, "utf-8") };
  }

  const sniffed = sniffRaster(input.bytes);
  if (sniffed !== ext) {
    throw new IconUploadError("File contents do not match a supported image type", 415);
  }
  return { ext, bytes: Buffer.from(input.bytes) };
}

/** Writes the processed icon and returns its `<hash>.<ext>` filename. */
export async function storeIconUpload(icon: ProcessedIcon): Promise<string> {
  const hash = createHash("sha256").update(icon.bytes).digest("hex").slice(0, 32);
  const filename = `${hash}.${icon.ext}`;
  const dir = uploadsIconDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), icon.bytes);
  return filename;
}

export interface StoredIcon {
  bytes: Buffer;
  contentType: string;
}

/** Reads a stored icon back, or null if the name is malformed or missing. */
export async function readIconUpload(filename: string): Promise<StoredIcon | null> {
  if (!ICON_FILENAME_PATTERN.test(filename)) return null;
  const ext = filename.slice(filename.lastIndexOf(".") + 1);
  const contentType = EXT_CONTENT_TYPE[ext];
  if (!contentType) return null;
  try {
    const bytes = await readFile(path.join(uploadsIconDir(), filename));
    return { bytes, contentType };
  } catch {
    return null;
  }
}
