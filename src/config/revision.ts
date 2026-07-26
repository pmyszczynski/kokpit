// Content revision of a config: a purpose-separated HMAC over its canonical
// JSON serialization. Two structurally-equal configs hash identically; any
// change to services, groups, bookmarks, appearance, layout, etc. changes the
// hash without exposing an offline oracle for low-entropy saved credentials.
//
// Server-only (`node:crypto`). The client never computes a revision — it reads
// the value from the `X-Config-Revision` response header of GET /api/settings.
import { createHmac } from "node:crypto";
import { getServerSecret } from "@/auth/serverSecret";
import type { KokpitConfig } from "./schema";
import { canonicalJSONString } from "./canonicalJson";

const PURPOSE = "kokpit/config-revision/v1";

function revisionKey(): Buffer {
  return createHmac("sha256", getServerSecret()).update(PURPOSE).digest();
}

/** Stable purpose-separated HMAC-SHA256 revision of canonical config JSON. */
export function configRevision(config: KokpitConfig): string {
  return createHmac("sha256", revisionKey())
    .update(canonicalJSONString(config))
    .digest("hex");
}

// Re-exported so server callers (the API route) can import both from here; the
// definition lives in a Node-free module for client use.
export { CONFIG_REVISION_HEADER } from "./revisionHeader";
