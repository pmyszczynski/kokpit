import { watch, type FSWatcher } from "fs";
import { getConfigPath, invalidateCache } from "./loader";

let watcher: FSWatcher | null = null;

export function startConfigWatcher(): void {
  if (watcher) return;

  watcher = watch(getConfigPath(), () => {
    console.log("[kokpit] settings.yaml changed, reloading config...");
    invalidateCache();
  });
}

export function stopConfigWatcher(): void {
  watcher?.close();
  watcher = null;
}
