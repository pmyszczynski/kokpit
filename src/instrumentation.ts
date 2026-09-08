export async function register() {
  // `register` also runs while Next is building. Runtime initialization there
  // would create settings.yaml and session state inside the build context,
  // which standalone tracing could then copy into the production image.
  if (
    process.env.NEXT_RUNTIME === "nodejs"
    && process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    await import("./instrumentation.node");
  }
}
