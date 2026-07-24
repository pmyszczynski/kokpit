// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { KokpitConfig } from "@/config";
import { collectReferencedUploads } from "@/lib/uploadGc";
import { pruneUploads, UPLOAD_GC_GRACE_MS } from "@/lib/uploads";
import { ICON_PROFILE } from "@/lib/iconUploads";

const ICON_A = "a".repeat(32) + ".png"; // service icon
const ICON_B = "b".repeat(32) + ".svg"; // bookmark link icon
const BG_C = "c".repeat(32) + ".jpg"; // background image

// A config exercising every reference source plus a bunch of refs that must be
// ignored (shorthand, plain URL, absent, malformed, traversal).
function makeConfig(): KokpitConfig {
  return {
    schema_version: 1,
    auth: { enabled: false, session_ttl_hours: 24 },
    appearance: {
      theme: "dark",
      background: { image: `/api/backgrounds/user/${BG_C}` },
    },
    layout: { columns: 4, row_height: 120 },
    services: [
      { name: "Uploaded", icon: `/api/icons/user/${ICON_A}` },
      { name: "Shorthand", icon: "sh-github" },
      { name: "PlainUrl", icon: "https://example.com/logo.png" },
      { name: "NoIcon" },
      // last segment "passwd" fails the filename pattern → excluded
      { name: "Traversal", icon: "/api/icons/user/../../etc/passwd" },
      // hash too short (<16 hex) → excluded
      { name: "Malformed", icon: "/api/icons/user/short.png" },
    ],
    bookmarks: [
      {
        name: "Dev",
        links: [
          { name: "GH", url: "https://github.com", icon: `/api/icons/user/${ICON_B}` },
          { name: "Plain", url: "https://plain.example" },
        ],
      },
    ],
  } as unknown as KokpitConfig;
}

describe("collectReferencedUploads", () => {
  it("collects uploaded icon and background filenames, ignoring everything else", () => {
    const refs = collectReferencedUploads(makeConfig());
    expect([...refs.icons].sort()).toEqual([ICON_A, ICON_B].sort());
    expect([...refs.backgrounds]).toEqual([BG_C]);
  });

  it("excludes malformed and traversal filenames", () => {
    const refs = collectReferencedUploads(makeConfig());
    expect(refs.icons.has("passwd")).toBe(false);
    expect(refs.icons.has("short.png")).toBe(false);
    // Cross-prefix isolation: a background image pointing under the ICONS
    // prefix must not leak into either set — background.image is only matched
    // against the backgrounds prefix, so the value is ignored entirely.
    const refs2 = collectReferencedUploads({
      schema_version: 1,
      auth: { enabled: false, session_ttl_hours: 24 },
      appearance: { theme: "dark", background: { image: `/api/icons/user/${BG_C}` } },
      layout: { columns: 4, row_height: 120 },
      services: [],
    } as unknown as KokpitConfig);
    expect(refs2.backgrounds.size).toBe(0);
    expect(refs2.icons.size).toBe(0);
  });

  it("is defensive about absent optional arrays/fields", () => {
    const minimal = {
      schema_version: 1,
      auth: { enabled: false, session_ttl_hours: 24 },
      appearance: { theme: "dark" },
      layout: { columns: 4, row_height: 120 },
      services: [],
    } as unknown as KokpitConfig;
    const refs = collectReferencedUploads(minimal);
    expect(refs.icons.size).toBe(0);
    expect(refs.backgrounds.size).toBe(0);
  });
});

describe("pruneUploads", () => {
  let base: string;
  let iconsDir: string;

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), "kokpit-gc-"));
    process.env.KOKPIT_UPLOADS_PATH = base;
    iconsDir = path.join(base, ICON_PROFILE.subdir);
    await mkdir(iconsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
    delete process.env.KOKPIT_UPLOADS_PATH;
  });

  async function writeIcon(name: string, ageMs = 0) {
    const full = path.join(iconsDir, name);
    await writeFile(full, "x");
    if (ageMs > 0) {
      const when = new Date(Date.now() - ageMs);
      await utimes(full, when, when);
    }
    return full;
  }

  it("deletes stale orphans, keeps referenced and within-grace files", async () => {
    const referenced = ICON_A;
    const staleOrphan = "d".repeat(32) + ".png";
    const freshOrphan = "e".repeat(32) + ".png";
    const notOurs = "notes.txt";

    // referenced + stale so grace wouldn't save it anyway
    await writeIcon(referenced, UPLOAD_GC_GRACE_MS * 2);
    // stale, unreferenced → should be deleted
    await writeIcon(staleOrphan, UPLOAD_GC_GRACE_MS * 2);
    // fresh, unreferenced → within grace, survives
    await writeIcon(freshOrphan, 0);
    // doesn't match the stored-filename pattern → never touched
    await writeIcon(notOurs, UPLOAD_GC_GRACE_MS * 2);

    const deleted = await pruneUploads(
      ICON_PROFILE,
      new Set([referenced]),
      UPLOAD_GC_GRACE_MS
    );

    expect(deleted).toBe(1);
    await expect(stat(path.join(iconsDir, referenced))).resolves.toBeDefined();
    await expect(stat(path.join(iconsDir, freshOrphan))).resolves.toBeDefined();
    await expect(stat(path.join(iconsDir, notOurs))).resolves.toBeDefined();
    await expect(stat(path.join(iconsDir, staleOrphan))).rejects.toThrow();
  });

  it("returns 0 when the storage dir does not exist", async () => {
    await rm(base, { recursive: true, force: true });
    const deleted = await pruneUploads(ICON_PROFILE, new Set(), UPLOAD_GC_GRACE_MS);
    expect(deleted).toBe(0);
  });
});
