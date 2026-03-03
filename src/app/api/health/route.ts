// Health check endpoint — used by Docker HEALTHCHECK and monitoring tools.
// Returns 200 OK with basic status JSON.

export async function GET() {
  return Response.json({
    status: "ok",
    version: process.env.npm_package_version ?? "unknown",
    timestamp: new Date().toISOString(),
  });
}
