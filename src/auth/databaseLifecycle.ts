import type { KokpitConfig } from "@/config/schema";
import { subscribeConfigPublication } from "@/config/publication";
import { isAuthenticationEnabled } from "./policy";
import { getDb } from "./db";

type Lifecycle = {
  active: boolean;
  generation: number;
  failureCodes: Set<string>;
  retryAttempt: number;
  retryTimer?: ReturnType<typeof setTimeout>;
  unsubscribe: () => void;
};
const LIFECYCLE_KEY = Symbol.for("kokpit.auth.database.lifecycle");
// Two additional attempts only. SQLite lock waits retain getDb's synchronous
// 5 s busy timeout; background scheduling does not make initialization nonblocking.
const INITIALIZATION_RETRY_DELAYS_MS = [500, 1500] as const;
type Host = typeof globalThis & { [LIFECYCLE_KEY]?: Lifecycle };

const INITIALIZATION_ERROR_CODES = new Set([
  "SQLITE_CANTOPEN", "SQLITE_BUSY", "SQLITE_LOCKED", "SQLITE_READONLY",
  "SQLITE_PERM", "SQLITE_AUTH", "SQLITE_IOERR", "SQLITE_CORRUPT", "SQLITE_NOTADB",
  "SQLITE_FULL", "SQLITE_NOMEM", "SQLITE_ERROR",
  "EACCES", "EPERM", "ENOENT", "ENOTDIR", "EISDIR", "EEXIST", "ENOSPC",
  "EMFILE", "ENFILE", "EROFS", "ENOMEM", "EIO",
]);

function initializationFailureCode(error: unknown): string {
  try {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    return typeof code === "string" && INITIALIZATION_ERROR_CODES.has(code) ? code : "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

function resetInitializationRetry(lifecycle: Lifecycle): void {
  if (lifecycle.retryTimer !== undefined) clearTimeout(lifecycle.retryTimer);
  lifecycle.retryTimer = undefined;
  lifecycle.retryAttempt = 0;
}

function initializeRequiredDatabase(config: KokpitConfig, lifecycle: Lifecycle, generation: number): void {
  if (!isAuthenticationEnabled(config)) {
    resetInitializationRetry(lifecycle);
    lifecycle.failureCodes.clear();
    return;
  }
  try {
    getDb();
    resetInitializationRetry(lifecycle);
    lifecycle.failureCodes.clear();
  } catch (error) {
    // db.ts records unavailable before throwing. Log only bounded codes here,
    // outside probes, once per code until recovery or a policy/lifecycle reset.
    const code = initializationFailureCode(error);
    if (!lifecycle.failureCodes.has(code)) {
      lifecycle.failureCodes.add(code);
      try {
        console.error(`[kokpit] Authentication database initialization failed (${code}).`);
      } catch { /* A diagnostic sink must not interrupt initialization lifecycle work. */ }
    }
    if ((code === "SQLITE_BUSY" || code === "SQLITE_LOCKED")
      && lifecycle.active && lifecycle.generation === generation
      && lifecycle.retryAttempt < INITIALIZATION_RETRY_DELAYS_MS.length) {
      const delay = INITIALIZATION_RETRY_DELAYS_MS[lifecycle.retryAttempt++];
      lifecycle.retryTimer = setTimeout(() => {
        if (!lifecycle.active || lifecycle.generation !== generation) return;
        lifecycle.retryTimer = undefined;
        initializeRequiredDatabase(config, lifecycle, generation);
      }, delay);
      lifecycle.retryTimer.unref();
    }
  }
}

export function startDatabaseLifecycle(initialConfig: KokpitConfig): void {
  stopDatabaseLifecycle();
  const lifecycle: Lifecycle = { active: true, generation: 0, failureCodes: new Set(), retryAttempt: 0, unsubscribe: () => {} };
  lifecycle.unsubscribe = subscribeConfigPublication((config) => {
    resetInitializationRetry(lifecycle);
    const generation = ++lifecycle.generation;
    // Configuration publication can occur while its write lock is held.
    // Initialize after that synchronous operation, independently of probes.
    queueMicrotask(() => {
      if (lifecycle.active && lifecycle.generation === generation) initializeRequiredDatabase(config, lifecycle, generation);
    });
  });
  (globalThis as Host)[LIFECYCLE_KEY] = lifecycle;
  initializeRequiredDatabase(initialConfig, lifecycle, lifecycle.generation);
}

export function stopDatabaseLifecycle(): void {
  const lifecycle = (globalThis as Host)[LIFECYCLE_KEY];
  if (lifecycle) { lifecycle.active = false; resetInitializationRetry(lifecycle); lifecycle.unsubscribe(); }
  delete (globalThis as Host)[LIFECYCLE_KEY];
}
