import { watch, type FSWatcher } from "fs";
import path from "path";
import { getConfigPath, invalidateCache } from "./loader";

let watcher: FSWatcher | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelayMs = 100;

const MAX_RETRY_DELAY_MS = 5_000;

function scheduleRestart(): void {
  if (retryTimer) return;

  const delay = retryDelayMs;
  retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    startConfigWatcher();
  }, delay);
}

function closeWatcher(activeWatcher: FSWatcher): void {
  try {
    activeWatcher.close();
  } catch (error) {
    console.error("[kokpit] could not close settings watcher:", error);
  }
}

export function startConfigWatcher(): void {
  if (watcher || retryTimer) return;

  const configPath = getConfigPath();
  const configName = path.basename(configPath);
  try {
    const activeWatcher = watch(path.dirname(configPath), (_eventType, filename) => {
      if (filename && filename.toString() !== configName) return;
      console.log("[kokpit] settings.yaml changed, reloading config...");
      invalidateCache();
      retryDelayMs = 100;
    });
    watcher = activeWatcher;
    activeWatcher.on("error", (error) => {
      if (watcher !== activeWatcher) return;
      console.error("[kokpit] settings watcher failed:", error);
      closeWatcher(activeWatcher);
      watcher = null;
      scheduleRestart();
    });
  } catch (error) {
    console.error("[kokpit] could not start settings watcher:", error);
    scheduleRestart();
  }
}

export function stopConfigWatcher(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (watcher) closeWatcher(watcher);
  watcher = null;
  retryDelayMs = 100;
}
