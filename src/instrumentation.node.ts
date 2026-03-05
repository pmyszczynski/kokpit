import { loadConfig } from "./config";
import { startConfigWatcher } from "./config/watcher";

// Validate config on startup — crashes loudly if settings.yaml is malformed.
loadConfig();

if (process.env.NODE_ENV === "development") {
  startConfigWatcher();
}
