// Health check endpoint — used by Docker HEALTHCHECK and monitoring tools.
// Returns 200 OK with basic status JSON.
import { BUILD_VERSION } from "@/lib/buildVersion.server";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    status: "ok",
    version: BUILD_VERSION,
    timestamp: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
