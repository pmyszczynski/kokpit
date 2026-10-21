import { createHash } from "node:crypto";
import { fetchWithHardTimeout } from "@/lib/fetchTimeout";

export const WIDGET_RESULT_TTL_MS = 5_000;
export const DEFAULT_WIDGET_POLL_MS = 30_000;
export const MAX_WIDGET_RESULT_ENTRIES = 256;
export const MAX_WIDGET_RESULT_BYTES = 16 * 1024 * 1024;
export const MAX_WIDGET_RESULT_PAYLOAD_BYTES = 1024 * 1024;
export const MAX_WIDGET_PENDING_FETCHES = 64;

export class WidgetCacheBusyError extends Error {
  constructor() { super("Widget request capacity exhausted"); }
}
export class WidgetCacheInvalidatedError extends Error {
  constructor() { super("Widget configuration changed"); }
}
export class WidgetConsumerAbortedError extends Error {
  constructor() { super("Widget request cancelled"); }
}

const definitionIds = new WeakMap<object, number>();
let nextDefinitionId = 0;

/** Distinct live plugin definitions cannot reuse one another's cached output. */
export function widgetDefinitionIdentity(definition: object): number {
  let id = definitionIds.get(definition);
  if (id === undefined) {
    id = ++nextDefinitionId;
    definitionIds.set(definition, id);
  }
  return id;
}

/** Sort JSON keys without treating an input __proto__ key as an assignment. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) result[key] = canonical(entry);
    }
    return result;
  }
  return value;
}

/** Internal-only opaque identity; callers must never expose its input or hash. */
export function widgetResultIdentity(input: unknown): string {
  return createHash("sha256").update("kokpit/widget-result/v1\0")
    .update(JSON.stringify(canonical(input))).digest("hex");
}

type SerializedResult = { json: string | undefined; data: unknown };
type Settled = { json: string; bytes: number; completedAt: number };
type Pending = { promise: Promise<SerializedResult>; retain: boolean };

interface CacheOptions {
  now: () => number;
  maxEntries: number;
  maxBytes: number;
  maxPayloadBytes: number;
  maxPending: number;
}

/** A consumer detaches promptly; the cache owns the independent upstream task. */
async function forConsumer<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task;
  if (signal.aborted) throw new WidgetConsumerAbortedError();
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(new WidgetConsumerAbortedError()); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    task.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/** Bounded process-local storage of successful public widget JSON and work. */
export class WidgetResultCache {
  private readonly options: CacheOptions;
  private generation: string | null = null;
  private epoch = 0;
  private retainedBytes = 0;
  private readonly settled = new Map<string, Settled>();
  private readonly pending = new Map<string, Pending>();
  // A hard timeout detaches consumers but cannot stop noncooperative work.
  // Keep its permit until actual settlement, including across generations.
  private activeLoads = 0;

  constructor(options: Partial<CacheOptions> = {}) {
    this.options = {
      now: () => performance.now(), maxEntries: MAX_WIDGET_RESULT_ENTRIES,
      maxBytes: MAX_WIDGET_RESULT_BYTES, maxPayloadBytes: MAX_WIDGET_RESULT_PAYLOAD_BYTES,
      maxPending: MAX_WIDGET_PENDING_FETCHES, ...options,
    };
  }

  /** Invalidate retained data without cancelling tasks another request awaits. */
  observeGeneration(generation: string | null): number {
    if (generation !== this.generation) {
      this.generation = generation;
      this.epoch += 1;
      this.settled.clear();
      this.retainedBytes = 0;
    }
    return this.epoch;
  }

  /** A return to identical source bytes does not revive an old observed epoch. */
  isCurrent(epoch: number): boolean { return this.generation !== null && epoch === this.epoch; }

  private remove(key: string): void {
    const entry = this.settled.get(key);
    if (entry) this.retainedBytes -= entry.bytes;
    this.settled.delete(key);
  }

  private prune(): void {
    const now = this.options.now();
    for (const [key, entry] of this.settled) {
      if (now - entry.completedAt >= WIDGET_RESULT_TTL_MS) this.remove(key);
    }
  }

  /** Freshness is chosen by each caller; interval 0 uses in-flight sharing only. */
  async get(
    key: string,
    intervalMs: number,
    load: (signal: AbortSignal) => Promise<unknown>,
    timeoutMs?: number,
    consumerSignal?: AbortSignal
  ): Promise<unknown> {
    if (consumerSignal?.aborted) throw new WidgetConsumerAbortedError();
    if (this.generation === null) throw new WidgetCacheInvalidatedError();
    const epoch = this.epoch;
    const freshness = intervalMs > 0 ? Math.min(intervalMs, WIDGET_RESULT_TTL_MS) : 0;
    this.prune();
    const cached = this.settled.get(key);
    if (cached && freshness > 0 && this.options.now() - cached.completedAt < freshness) {
      this.settled.delete(key);
      this.settled.set(key, cached);
      return JSON.parse(cached.json);
    }
    const pendingKey = `${epoch}:${key}`;
    let entry = this.pending.get(pendingKey);
    if (entry) {
      if (freshness > 0) entry.retain = true;
    } else {
      if (this.pending.size >= this.options.maxPending || this.activeLoads >= this.options.maxPending) {
        throw new WidgetCacheBusyError();
      }
      this.activeLoads += 1;
      let started = false;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          this.activeLoads -= 1;
        }
      };
      const pending: Pending = { retain: freshness > 0, promise: Promise.resolve({ json: undefined, data: undefined }) };
      // Defer load until the slot exists, including for synchronous/reentrant
      // integrations. The hard timeout belongs to this shared operation.
      pending.promise = Promise.resolve()
        .then(() => fetchWithHardTimeout(signal => {
          started = true;
          try {
            const task = Promise.resolve(load(signal));
            // Observe settlement without replacing the timeout race's task.
            void task.then(release, release);
            return task;
          } catch (error) {
            release();
            throw error;
          }
        }, "Widget fetch timed out", timeoutMs))
        .then(data => {
          const json = JSON.stringify(data);
          const bytes = json === undefined ? 0 : Buffer.byteLength(json, "utf8");
          if (json !== undefined && pending.retain && this.isCurrent(epoch)
            && bytes <= this.options.maxPayloadBytes && bytes <= this.options.maxBytes
            && this.options.maxEntries > 0) {
            this.prune();
            // The old success can remain fresh for other callers while this
            // refresh runs. Account for its replacement only when storing.
            this.remove(key);
            while (this.settled.size >= this.options.maxEntries || this.retainedBytes + bytes > this.options.maxBytes) {
              const oldest = this.settled.keys().next().value;
              if (oldest === undefined) break;
              this.remove(oldest);
            }
            this.settled.set(key, { json, bytes, completedAt: this.options.now() });
            this.retainedBytes += bytes;
          }
          return { json, data };
        })
        .finally(() => {
          this.pending.delete(pendingKey);
          // Setup can reject before the wrapper invokes the actual load.
          if (!started) release();
        });
      // A disconnected final consumer does not leave an unhandled rejection.
      void pending.promise.catch(() => {});
      this.pending.set(pendingKey, pending);
      entry = pending;
    }
    const result = await forConsumer(entry.promise, consumerSignal);
    if (!this.isCurrent(epoch)) throw new WidgetCacheInvalidatedError();
    // Each caller gets an independent decoded value; integration caches or
    // consumers cannot mutate a retained success by changing an object later.
    return result.json === undefined ? result.data : JSON.parse(result.json);
  }
}

export const widgetResultCache = new WidgetResultCache();
