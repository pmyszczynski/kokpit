import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RGBA_COLOR_TYPE = 6;

interface PngInfo {
  width: number;
  height: number;
  colorType: number;
}

function readPng(relativePath: string): PngInfo {
  const buf = readFileSync(path.join(process.cwd(), relativePath));
  expect(buf.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf.readUInt8(25),
  };
}

describe("Kokpit brand PNG assets", () => {
  const cases: Array<[relativePath: string, size: number]> = [
    ["public/brand/kokpit/png/kokpit-favicon-16.png", 16],
    ["public/brand/kokpit/png/kokpit-favicon-32.png", 32],
    ["public/brand/kokpit/png/kokpit-favicon-48.png", 48],
    ["public/brand/kokpit/png/kokpit-favicon-64.png", 64],
    ["public/brand/kokpit/png/kokpit-mark-navbar-64.png", 64],
    ["public/brand/kokpit/png/kokpit-apple-touch-icon-180.png", 180],
    ["public/brand/kokpit/png/kokpit-icon-192.png", 192],
    ["public/brand/kokpit/png/kokpit-icon-512.png", 512],
    ["public/brand/kokpit/png/kokpit-mark-512.png", 512],
    ["src/app/icon.png", 512],
    ["src/app/apple-icon.png", 180],
  ];

  it.each(cases)("%s is a square %ipx PNG", (relativePath, size) => {
    const { width, height } = readPng(relativePath);
    expect(width).toBe(size);
    expect(height).toBe(size);
  });

  it.each(cases)("%s has an alpha channel (transparent background)", (relativePath) => {
    const { colorType } = readPng(relativePath);
    expect(colorType).toBe(RGBA_COLOR_TYPE);
  });

  it("the Apple touch icon matches src/app/apple-icon.png used by the metadata route", () => {
    const brand = readFileSync(
      path.join(process.cwd(), "public/brand/kokpit/png/kokpit-apple-touch-icon-180.png"),
    );
    const appIcon = readFileSync(path.join(process.cwd(), "src/app/apple-icon.png"));
    expect(appIcon.equals(brand)).toBe(true);
  });

  it("the 512px mark matches src/app/icon.png used by the metadata route", () => {
    const brand = readFileSync(
      path.join(process.cwd(), "public/brand/kokpit/png/kokpit-icon-512.png"),
    );
    const appIcon = readFileSync(path.join(process.cwd(), "src/app/icon.png"));
    expect(appIcon.equals(brand)).toBe(true);
  });
});

describe("Kokpit favicon.ico", () => {
  it("starts with the ICO format magic header", () => {
    const buf = readFileSync(path.join(process.cwd(), "public/brand/kokpit/favicon.ico"));
    // ICO header: reserved (2 bytes, must be 0), type (2 bytes, 1 = icon)
    expect(buf.readUInt16LE(0)).toBe(0);
    expect(buf.readUInt16LE(2)).toBe(1);
  });

  it("declares at least one embedded image", () => {
    const buf = readFileSync(path.join(process.cwd(), "public/brand/kokpit/favicon.ico"));
    const imageCount = buf.readUInt16LE(4);
    expect(imageCount).toBeGreaterThan(0);
  });
});

describe("public/site.webmanifest", () => {
  function readManifest(): {
    name: string;
    short_name: string;
    icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
    background_color: string;
    theme_color: string;
    display: string;
  } {
    const raw = readFileSync(path.join(process.cwd(), "public/site.webmanifest"), "utf-8");
    return JSON.parse(raw);
  }

  it("is valid JSON with the expected top-level fields", () => {
    const manifest = readManifest();
    expect(manifest.name).toBe("Kokpit");
    expect(manifest.short_name).toBe("Kokpit");
    expect(manifest.background_color).toBe("#0B1020");
    expect(manifest.theme_color).toBe("#0B1020");
    expect(manifest.display).toBe("standalone");
  });

  it("declares 192x192 and 512x512 icons pointing at the Kokpit brand assets", () => {
    const manifest = readManifest();
    expect(manifest.icons).toHaveLength(2);

    const bySize = new Map(manifest.icons.map((icon) => [icon.sizes, icon]));

    expect(bySize.get("192x192")).toMatchObject({
      src: "/brand/kokpit/png/kokpit-icon-192.png",
      type: "image/png",
      purpose: "any",
    });
    expect(bySize.get("512x512")).toMatchObject({
      src: "/brand/kokpit/png/kokpit-icon-512.png",
      type: "image/png",
      purpose: "any",
    });
  });

  it("every referenced icon file exists in public/", () => {
    const manifest = readManifest();
    for (const icon of manifest.icons) {
      const filePath = path.join(process.cwd(), "public", icon.src);
      expect(() => readFileSync(filePath)).not.toThrow();
    }
  });
});