import type { ServiceProbeResult } from "./serviceStatus";

interface Entry {
  generation: string;
  result?: ServiceProbeResult;
  expiresAt: number;
  failures: number;
  promise: Promise<ServiceProbeResult>;
}
type Work = { run: () => void };

/** Request-driven process cache: bounded queued HEADs, shared by all tabs. */
export function createServiceStatusScheduler({
  probe, isCurrent, now = Date.now,
}: {
  probe: (url: string) => Promise<ServiceProbeResult>;
  isCurrent: (generation: string) => boolean;
  now?: () => number;
}) {
  const entries = new Map<string, Entry>();
  const queue: Work[] = [];
  let active = 0;
  const unavailable = (reason: "capacity" | "configuration-changed"): ServiceProbeResult => ({
    ok: false, reachable: null, assessment: "unavailable", reason, checkedAt: now(), responseTimeMs: null,
  });
  function current(generation: string) {
    try { return isCurrent(generation); } catch { return false; }
  }
  function drain() {
    while (active < 8 && queue.length) queue.shift()!.run();
  }
  return {
    get(key: string, url: string, generation: string): Promise<ServiceProbeResult> {
      const old = entries.get(key);
      if (old && old.generation === generation && (!old.result || old.expiresAt > now())) return old.promise;
      if (active + queue.length >= 100) return Promise.resolve(unavailable("capacity"));
      if (old) entries.delete(key);
      // Discard old settled generations first; never evict pending work.
      for (const [id, entry] of entries) {
        if (entry.result && entry.generation !== generation) entries.delete(id);
      }
      if (entries.size >= 500) {
        const settled = [...entries].find(([, entry]) => entry.result);
        if (settled) entries.delete(settled[0]);
      }
      let resolve!: (value: ServiceProbeResult) => void;
      const entry: Entry = { generation, failures: old?.failures ?? 0, expiresAt: Infinity,
        promise: new Promise(done => { resolve = done; }) };
      entries.set(key, entry);
      queue.push({ run() {
        active++;
        void (async () => {
          let result: ServiceProbeResult;
          try {
            result = current(generation) ? await probe(url) : unavailable("configuration-changed");
          } catch {
            result = { ok: false, reachable: null, assessment: "unavailable", reason: "checker-failed", checkedAt: now(), responseTimeMs: null };
          }
          if (!current(generation)) {
            if (entries.get(key) === entry) entries.delete(key);
            result = unavailable("configuration-changed");
          } else {
            entry.result = result;
            entry.failures = result.reachable === true ? 0 : entry.failures + 1;
            entry.expiresAt = now() + Math.min(300_000, 30_000 * 2 ** Math.max(0, entry.failures - 1));
          }
          resolve(result);
          active--;
          drain();
        })();
      } });
      drain();
      return entry.promise;
    },
  };
}
