// Server-only: garbage-collection of orphaned user uploads (tile icons and
// dashboard backgrounds). Uploads are hash-addressed and re-uploaded on every
// tweak, so re-picking a background ten times while tuning would otherwise leave
// nine dead files in the persisted volume. On each config save we compute the
// set of upload filenames still referenced by the FULL merged config and prune
// everything else (subject to a grace window — see pruneUploads).
import type { KokpitConfig } from "@/config";
import { BACKGROUND_PROFILE } from "./backgroundUploads";
import { ICON_PROFILE } from "./iconUploads";
import { pruneUploads, UPLOAD_FILENAME_PATTERN, UPLOAD_GC_GRACE_MS } from "./uploads";

// Uploaded icons/backgrounds are referenced in config as these serve paths.
const ICON_PREFIX = "/api/icons/user/";
const BACKGROUND_PREFIX = "/api/backgrounds/user/";

/**
 * If `ref` is an uploaded-file serve path under `prefix`, return its last path
 * segment when that segment is a valid stored filename; otherwise null. Plain
 * URLs, shorthand icon refs (e.g. "sh-github"), and traversal-y paths all fall
 * through to null (the last segment fails UPLOAD_FILENAME_PATTERN).
 */
function referencedFilename(ref: string, prefix: string): string | null {
  if (!ref.startsWith(prefix)) return null;
  const last = ref.slice(ref.lastIndexOf("/") + 1);
  return UPLOAD_FILENAME_PATTERN.test(last) ? last : null;
}

/**
 * Walks the full config and collects the filenames of every uploaded icon /
 * background still in use. Sources walked:
 *   - services[].icon
 *   - bookmarks[].links[].icon
 *   - appearance.background.image
 * Every field is optional and defensively guarded; only well-formed uploaded
 * refs contribute (external URLs and shorthand refs are ignored).
 */
export function collectReferencedUploads(config: KokpitConfig): {
  icons: Set<string>;
  backgrounds: Set<string>;
} {
  const icons = new Set<string>();
  const backgrounds = new Set<string>();

  const addIcon = (ref: string | undefined) => {
    if (!ref) return;
    const name = referencedFilename(ref, ICON_PREFIX);
    if (name) icons.add(name);
  };

  for (const svc of config.services ?? []) {
    addIcon(svc.icon);
  }
  for (const group of config.bookmarks ?? []) {
    for (const link of group.links ?? []) {
      addIcon(link.icon);
    }
  }

  const bgImage = config.appearance?.background?.image;
  if (bgImage) {
    const name = referencedFilename(bgImage, BACKGROUND_PREFIX);
    if (name) backgrounds.add(name);
  }

  return { icons, backgrounds };
}

/**
 * Deletes uploaded icon/background files no longer referenced by `config`.
 * MUST be called with the FULL merged config (not a partial patch body), so a
 * save that only touches, say, layout can't delete icons referenced by unchanged
 * services. Never throws: cleanup is best-effort and must not turn a successful
 * save into an error.
 */
export async function pruneOrphanedUploads(config: KokpitConfig): Promise<void> {
  try {
    const refs = collectReferencedUploads(config);
    // Independent storage dirs — prune both concurrently.
    await Promise.all([
      pruneUploads(ICON_PROFILE, refs.icons, UPLOAD_GC_GRACE_MS),
      pruneUploads(BACKGROUND_PROFILE, refs.backgrounds, UPLOAD_GC_GRACE_MS),
    ]);
  } catch {
    // Best-effort cleanup — swallow everything.
  }
}
