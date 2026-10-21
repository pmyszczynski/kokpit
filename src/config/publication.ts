import type { KokpitConfig } from "./schema";

type Listener = (config: KokpitConfig) => void;
const LISTENERS_KEY = Symbol.for("kokpit.config.publication.listeners");
const FAILED_LISTENERS_KEY = Symbol.for("kokpit.config.publication.failedListeners");

function listeners(): Set<Listener> {
  const host = globalThis as typeof globalThis & { [LISTENERS_KEY]?: Set<Listener> };
  return host[LISTENERS_KEY] ??= new Set();
}

function failedListeners(): WeakSet<Listener> {
  const host = globalThis as typeof globalThis & { [FAILED_LISTENERS_KEY]?: WeakSet<Listener> };
  return host[FAILED_LISTENERS_KEY] ??= new WeakSet();
}

/** Application lifecycle work subscribes outside the read-only probe path. */
export function subscribeConfigPublication(listener: Listener): () => void {
  listeners().add(listener);
  return () => { listeners().delete(listener); failedListeners().delete(listener); };
}

export function notifyConfigPublished(config: KokpitConfig): void {
  const failed = failedListeners();
  for (const listener of listeners()) {
    // Observers do not own publication: a lifecycle failure cannot turn an
    // already successful configuration save into a failed write response.
    try {
      listener(config);
      failed.delete(listener);
    } catch {
      if (failed.has(listener)) continue;
      failed.add(listener);
      // One fixed diagnostic per failure incident; never log callback inputs
      // or errors, which can contain configuration, paths or credentials.
      try { console.error("[kokpit] Configuration publication callback failed."); }
      catch { /* Diagnostic output cannot turn a committed save into failure. */ }
    }
  }
}
