import { startPolling, retryAfterMilliseconds, type PollingLifecycle } from "./clientPolling";
import { parseServiceProbe, type ServiceProbeResult, type UnavailableReason } from "./serviceStatus";

export type StatusState = {
  observation: Exclude<ServiceProbeResult, { reachable: null }> | null;
  unavailable: UnavailableReason | "authorization" | "invalid-response" | null;
};
type Listener = (state: StatusState) => void;
interface Entry { key: string; id: string; state: StatusState; listeners: Set<Listener> }
const owners = new WeakMap<PollingLifecycle, ReturnType<typeof createOwner>>();

/** One completion-scheduled browser poller per protected surface, not per tile. */
function createOwner(lifecycle: PollingLifecycle) {
  const entries = new Map<string, Entry>();
  let polling: ReturnType<typeof startPolling> | undefined;
  let scheduled = false;
  function publish(entry: Entry, state: StatusState) {
    if (entries.get(entry.key) !== entry) return;
    entry.state = state;
    for (const listener of entry.listeners) listener(state);
  }
  function restart() {
    if (scheduled) return;
    scheduled = true;
    // Mounting many tiles in one commit produces one initial batch.
    void Promise.resolve().then(() => {
      scheduled = false;
      polling?.dispose(); polling = undefined;
      if (!entries.size) return;
      polling = startPolling({ interval: 30_000, lifecycle, async attempt(signal) {
        const ids = [...new Set([...entries.values()].map(entry => entry.id))].sort();
        let failed = false;
        let retryAfterMs: number | undefined;
        for (let index = 0; index < ids.length; index += 20) {
          if (signal.aborted) return { kind: "success" };
          const batch = ids.slice(index, index + 20);
          // Capture identities so an old destination cannot fill a replacement.
          const recipients = [...entries.values()].filter(entry => batch.includes(entry.id));
          const unavailable = (reason: StatusState["unavailable"]) => {
            for (const entry of recipients) publish(entry, { ...entry.state, unavailable: reason });
          };
          try {
            const response = await fetch(`/api/status?${new URLSearchParams({ ids: batch.join(",") })}`, { signal, cache: "no-store" });
            if (signal.aborted) return { kind: "success" };
            retryAfterMs = retryAfterMilliseconds(response.headers?.get("Retry-After"));
            if (response.status === 409) { unavailable("configuration-changed"); failed = true; continue; }
            if ([400, 401, 403, 404].includes(response.status)) {
              const authorization = response.status === 401 || response.status === 403;
              unavailable(authorization ? "authorization" : "configuration-changed");
              return { kind: "reconcile", reason: { kind: authorization ? "authorization" : "identity", status: response.status } };
            }
            if (response.ok === false) {
              unavailable(response.status === 429 || response.status === 503 ? "capacity" : "checker-failed");
              failed = true; continue;
            }
            const body: unknown = await response.json();
            if (signal.aborted) return { kind: "success" };
            const statuses = body && typeof body === "object" && !Array.isArray(body)
              ? (body as { statuses?: unknown }).statuses : null;
            for (const entry of recipients) {
              const result = statuses && typeof statuses === "object" && !Array.isArray(statuses) && Object.hasOwn(statuses, entry.id)
                ? parseServiceProbe((statuses as Record<string, unknown>)[entry.id]) : null;
              if (!result || result.reachable === null) {
                publish(entry, { ...entry.state, unavailable: result?.reason ?? "invalid-response" });
                if (!result) failed = true;
              } else publish(entry, { observation: result, unavailable: null });
            }
          } catch {
            if (!signal.aborted) unavailable("checker-failed");
            failed = true;
          }
        }
        return failed ? { kind: "failure", retryAfterMs } : { kind: "success" };
      } });
    });
  }
  return {
    subscribe(id: string, destination: string, listener: Listener) {
      const key = `${id}\0${destination}`;
      let entry = entries.get(key);
      const created = !entry;
      if (!entry) {
        entry = { key, id, state: { observation: null, unavailable: null }, listeners: new Set() };
        entries.set(key, entry);
      }
      entry.listeners.add(listener);
      listener(entry.state);
      if (created) restart();
      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size) return;
        entries.delete(key);
        if (!entries.size) { polling?.dispose(); polling = undefined; }
        else restart();
      };
    },
  };
}

/** Duplicate tiles share state; preview/edit mode never subscribes. */
export function subscribeServiceStatus(id: string, destination: string, lifecycle: PollingLifecycle, listener: Listener) {
  let owner = owners.get(lifecycle);
  if (!owner) { owner = createOwner(lifecycle); owners.set(lifecycle, owner); }
  return owner.subscribe(id, destination, listener);
}
