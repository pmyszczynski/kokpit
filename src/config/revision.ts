// Content revision of a config: a sha256 over its canonical JSON serialization.
// Two structurally-equal configs hash identically; any change to services,
// groups, bookmarks, appearance, layout, etc. changes the hash.
//
// Server-only (`node:crypto`). The client never computes a revision — it reads
// the value from the `X-Config-Revision` response header of GET /api/settings.
import { createHash } from "node:crypto";
import type { KokpitConfig } from "./schema";
import { canonicalJSONString } from "./canonicalJson";

/** Stable sha256 (hex) revision of a config's canonical serialization. */
export function configRevision(config: KokpitConfig): string {
  return createHash("sha256")
    .update(canonicalJSONString(config))
    .digest("hex");
}

// Re-exported so server callers (the API route) can import both from here; the
// definition lives in a Node-free module for client use.
export { CONFIG_REVISION_HEADER } from "./revisionHeader";
