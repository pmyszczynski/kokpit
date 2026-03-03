export async function register() {
  // Validate config on startup — crashes loudly if settings.yaml is malformed.
  const { loadConfig } = await import("./config");
  loadConfig();

  if (process.env.NODE_ENV === "development") {
    const { startConfigWatcher } = await import("./config/watcher");
    startConfigWatcher();
  }
}
