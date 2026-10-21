import { loadConfig } from "./config/server";
import { startConfigWatcher } from "./config/watcher";
import { getServerSecret } from "./auth/serverSecret";
import { startDatabaseLifecycle } from "./auth/databaseLifecycle";

// Reject unsafe deployment keys before serving requests or publishing config.
// instrumentation.ts excludes this initialization during production builds.
getServerSecret();

// Validate config on startup — crashes loudly if settings.yaml is malformed.
const config = loadConfig();
startDatabaseLifecycle(config);

startConfigWatcher();
