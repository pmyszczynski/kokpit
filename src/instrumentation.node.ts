import { loadConfig } from "./config";
import { startConfigWatcher } from "./config/watcher";

// Validate config on startup — crashes loudly if settings.yaml is malformed.
loadConfig();

startConfigWatcher();
