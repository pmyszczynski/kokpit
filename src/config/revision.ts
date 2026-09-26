// Content revision of a config source: a purpose-separated HMAC over the exact
// YAML bytes. Formatting and comments are operator-owned data too, so a
// structurally-equivalent external edit must still invalidate a stale draft.
//
// Server-only (Node crypto). The client never computes a revision — it reads
// the value from the `X-Config-Revision` response header of GET /api/settings.
import { createHmac } from "crypto";
import { getServerSecret } from "@/auth/serverSecret";

const PURPOSE = "kokpit/config-source-revision/v2";

function revisionKey(): Buffer {
  return createHmac("sha256", getServerSecret()).update(PURPOSE).digest();
}

/** Stable purpose-separated HMAC-SHA256 revision of exact YAML source. */
export function configRevision(source: string): string {
  return createHmac("sha256", revisionKey())
    .update(source)
    .digest("hex");
}

// Re-exported so server callers (the API route) can import both from here; the
// definition lives in a Node-free module for client use.
export { CONFIG_REVISION_HEADER } from "./revisionHeader";
