import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/auth/apiAuth";
import { getPublishedConfigSnapshot } from "@/config/server";
import { configRevision } from "@/config/revision";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" };

function unavailable() {
  return NextResponse.json(
    { error: "Configuration temporarily unavailable", code: "config_unavailable" },
    { status: 503, headers: HEADERS }
  );
}

/** Poll only published state; a browser request must never bootstrap YAML. */
export async function GET() {
  try {
    const snapshot = getPublishedConfigSnapshot();
    if ((snapshot.state !== "ready" && snapshot.state !== "migration-required")
      || !snapshot.config || snapshot.source === null) return unavailable();

    const allowed = await isRequestAuthenticated(snapshot.config);
    // Session checks can yield while an external editor changes authorization.
    // Do not return even a last-good revision once those exact bytes changed.
    const current = getPublishedConfigSnapshot();
    if (current.state !== snapshot.state || current.source !== snapshot.source
      || current.config !== snapshot.config) return unavailable();
    if (!allowed) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });

    const revision = configRevision(snapshot.source);
    // Computing the HMAC may initialize its existing server secret. Confirm
    // the published source once more before exposing the revision.
    const confirmed = getPublishedConfigSnapshot();
    if (confirmed.state !== snapshot.state || confirmed.source !== snapshot.source
      || confirmed.config !== snapshot.config) return unavailable();

    return NextResponse.json(snapshot.state === "migration-required"
      ? { revision, editable: false, reason: "migration-required" }
      : { revision, editable: true }, { headers: HEADERS });
  } catch {
    return unavailable();
  }
}
