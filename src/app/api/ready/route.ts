import { observeConfigReadiness } from "@/config/server";
import { getDatabaseReadiness } from "@/auth/databaseReadiness";
import { isAuthenticationEnabled } from "@/auth/policy";
import { BUILD_VERSION } from "@/lib/buildVersion.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let config: "initializing" | "ready" | "unavailable" | "restart_required" = "unavailable";
  let database: "not_checked" | "not_required" | "initializing" | "ready" | "unavailable" = "not_checked";
  try {
    const observed = observeConfigReadiness();
    config = observed.state === "cold" ? "initializing"
      : observed.state === "migration-required" ? "restart_required"
      : observed.state === "ready" && observed.config ? "ready" : "unavailable";
    if (config === "ready" && observed.config) {
      database = isAuthenticationEnabled(observed.config) ? getDatabaseReadiness() : "not_required";
    }
  } catch { /* never expose errors, paths, source, SQL, or secrets through a public probe */ }
  const ready = config === "ready" && (database === "ready" || database === "not_required");
  return Response.json({
    status: ready ? "ready" : "not_ready", version: BUILD_VERSION,
    timestamp: new Date().toISOString(), checks: { config, database },
  }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
