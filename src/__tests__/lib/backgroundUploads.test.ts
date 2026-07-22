// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let uploadsDir: string;

beforeEach(() => {
  uploadsDir = mkdtempSync(path.join(tmpdir(), "kokpit-bg-"));
  process.env.KOKPIT_UPLOADS_PATH = uploadsDir;
});

afterEach(() => {
  rmSync(uploadsDir, { recursive: true, force: true });
  delete process.env.KOKPIT_UPLOADS_PATH;
});

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

async function fresh() {
  return import("@/lib/backgroundUploads");
}

describe("processBackgroundUpload — backgrounds profile", () => {
  it("accepts a real PNG", async () => {
    const { processBackgroundUpload } = await fresh();
    const r = processBackgroundUpload({
      bytes: PNG_MAGIC,
      declaredType: "image/png",
      filename: "bg.png",
    });
    expect(r.ext).toBe("png");
  });

  it("accepts a real JPG", async () => {
    const { processBackgroundUpload } = await fresh();
    const r = processBackgroundUpload({
      bytes: JPG_MAGIC,
      declaredType: "image/jpeg",
      filename: "bg.jpg",
    });
    expect(r.ext).toBe("jpg");
  });

  it("has a larger cap than icons (accepts a 3 MB file, rejects over 8 MB)", async () => {
    const { processBackgroundUpload, MAX_BACKGROUND_UPLOAD_BYTES } = await fresh();
    expect(MAX_BACKGROUND_UPLOAD_BYTES).toBe(8 * 1024 * 1024);

    const threeMb = new Uint8Array(3 * 1024 * 1024);
    threeMb.set(PNG_MAGIC);
    expect(
      processBackgroundUpload({ bytes: threeMb, declaredType: "image/png", filename: "a.png" }).ext
    ).toBe("png");

    const tooBig = new Uint8Array(8 * 1024 * 1024 + 1);
    tooBig.set(PNG_MAGIC);
    try {
      processBackgroundUpload({ bytes: tooBig, declaredType: "image/png", filename: "a.png" });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { status: number }).status).toBe(413);
    }
  });

  it("rejects SVG for backgrounds (not in the allowlist)", async () => {
    const { processBackgroundUpload } = await fresh();
    try {
      processBackgroundUpload({
        bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'),
        declaredType: "image/svg+xml",
        filename: "bg.svg",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { status: number }).status).toBe(415);
    }
  });

  it("rejects a disallowed type (gif)", async () => {
    const { processBackgroundUpload } = await fresh();
    try {
      processBackgroundUpload({
        bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38]),
        declaredType: "image/gif",
        filename: "a.gif",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { status: number }).status).toBe(415);
    }
  });
});

describe("storeBackgroundUpload / readBackgroundUpload", () => {
  it("round-trips a stored background into the backgrounds subdir", async () => {
    const { processBackgroundUpload, storeBackgroundUpload, readBackgroundUpload } =
      await fresh();
    const processed = processBackgroundUpload({
      bytes: PNG_MAGIC,
      declaredType: "image/png",
      filename: "bg.png",
    });
    const filename = await storeBackgroundUpload(processed);
    expect(filename).toMatch(/^[a-f0-9]{32}\.png$/);

    const stored = await readBackgroundUpload(filename);
    expect(stored?.contentType).toBe("image/png");
    expect(stored?.bytes.equals(processed.bytes)).toBe(true);
  });

  it("refuses a path-traversal or non-hash filename", async () => {
    const { readBackgroundUpload } = await fresh();
    expect(await readBackgroundUpload("../../etc/passwd")).toBeNull();
    expect(await readBackgroundUpload("nothash.png")).toBeNull();
  });

  it("refuses to read back an svg filename (outside this profile's allowlist)", async () => {
    const { readBackgroundUpload } = await fresh();
    expect(await readBackgroundUpload("deadbeefdeadbeefdeadbeefdeadbeef.svg")).toBeNull();
  });
});
