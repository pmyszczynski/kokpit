import { loadConfig } from "./config/server";
import { startConfigWatcher } from "./config/watcher";
import { getServerSecret } from "./auth/serverSecret";

// Reject unsafe deployment keys before serving requests or publishing config.
// instrumentation.ts excludes this initialization during production builds.
getServerSecret();

// Validate config on startup — crashes loudly if settings.yaml is malformed.
loadConfig();

startConfigWatcher();
