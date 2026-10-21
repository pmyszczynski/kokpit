/** Browser-local scheduling only; aborts never own shared server fetches. */
export type PollingReconciliation = {
  kind: "authorization" | "identity";
  status: number;
};

export interface PollingLifecycle {
  isEligible(): boolean;
  getVersion?(): number;
  subscribe(listener: () => void): () => void;
  reconcile(reason: PollingReconciliation): void;
}

/** One event source per protected surface, shared by every data subscription. */
export function createBrowserPollingLifecycle() {
  const listeners = new Set<() => void>();
  let accessAllowed = true;
  let version = 0;
  let beforeResume: (() => void) | undefined;
  let onReconciliation: ((reason: PollingReconciliation) => void) | undefined;

  const browserEligible = () =>
    (typeof document === "undefined" || document.visibilityState !== "hidden") &&
    (typeof navigator === "undefined" || navigator.onLine !== false);
  const notify = () => { for (const listener of listeners) listener(); };
  const onLifecycle = () => {
    // The configuration/access owner can synchronously close the gate before
    // child subscriptions receive a return-to-dashboard event.
    if (browserEligible()) beforeResume?.();
    notify();
  };
  const events = ["online", "offline", "focus"] as const;

  return {
    isEligible: () => accessAllowed && browserEligible(),
    getVersion: () => version,
    subscribe(listener: () => void) {
      if (listeners.size === 0 && typeof window !== "undefined") {
        document.addEventListener("visibilitychange", onLifecycle);
        for (const event of events) window.addEventListener(event, onLifecycle);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== "undefined") {
          document.removeEventListener("visibilitychange", onLifecycle);
          for (const event of events) window.removeEventListener(event, onLifecycle);
        }
      };
    },
    setAccessAllowed(allowed: boolean) {
      if (accessAllowed === allowed) return;
      accessAllowed = allowed;
      notify();
    },
    setBeforeResume(handler?: () => void) { beforeResume = handler; },
    setReconciliationHandler(handler?: (reason: PollingReconciliation) => void) { onReconciliation = handler; },
    /** The configuration owner calls this for changed effective fetch inputs. */
    invalidate() { version++; notify(); },
    reconcile(reason: PollingReconciliation) {
      accessAllowed = false;
      notify();
      onReconciliation?.(reason);
    },
  };
}

export const defaultPollingLifecycle = createBrowserPollingLifecycle();

export type PollOutcome =
  | { kind: "success" }
  | { kind: "failure"; retryAfterMs?: number }
  | { kind: "reconcile"; reason: PollingReconciliation };

interface PollingOptions {
  interval: number;
  lifecycle: PollingLifecycle;
  attempt(signal: AbortSignal): Promise<PollOutcome>;
  onPause?(): void;
  now?: () => number;
  random?: () => number;
  minimumRetryGap?: number;
}

/** Accept bounded delta-seconds or an HTTP date; malformed hints are ignored. */
export function retryAfterMilliseconds(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const text = value.trim();
  const milliseconds = /^\d+$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return undefined;
  return Math.min(milliseconds, 300_000);
}

/** Completion-scheduled, non-overlapping polling with local pause/cancellation. */
export function startPolling({
  interval,
  lifecycle,
  attempt,
  onPause,
  now = Date.now,
  random = Math.random,
  minimumRetryGap = 1000,
}: PollingOptions) {
  const base = Number.isFinite(interval) && interval > 0 ? interval : 0;
  const cap = Math.max(base, 300_000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: AbortController | undefined;
  let disposed = false;
  let initial = true;
  let interrupted = false;
  let manual = false;
  let pending = false;
  let failures = 0;
  let lifecycleRetryUsed = false;
  let lastStarted = Number.NEGATIVE_INFINITY;
  let due: number | undefined;
  let version = lifecycle.getVersion?.() ?? 0;
  let terminalIdentityVersion: number | undefined;

  function clearTimer() {
    clearTimeout(timer);
    timer = undefined;
  }

  function schedule(at: number) {
    clearTimer();
    if (disposed || !lifecycle.isEligible()) return;
    timer = setTimeout(() => {
      timer = undefined;
      // Browser timers overflow above a signed 32-bit delay. Long configured
      // intervals must wait in chunks rather than turn into a 1ms retry loop.
      if (now() < at) schedule(at);
      else void run();
    }, Math.min(2_147_483_647, Math.max(0, at - now())));
  }

  async function run() {
    if (disposed || active || !lifecycle.isEligible()) return;
    clearTimer();
    const controller = new AbortController();
    active = controller;
    lastStarted = now();
    manual = false;
    pending = false;
    interrupted = false;
    let outcome: PollOutcome;
    try {
      outcome = await attempt(controller.signal);
    } catch {
      outcome = { kind: "failure" };
    }
    if (disposed || controller.signal.aborted || active !== controller) return;
    active = undefined;
    initial = false;
    if (outcome.kind === "reconcile") {
      if (outcome.reason.kind === "identity") terminalIdentityVersion = version;
      interrupted = true;
      due = undefined;
      lifecycle.reconcile(outcome.reason);
      return;
    }
    if (outcome.kind === "success") {
      failures = 0;
      lifecycleRetryUsed = false;
      due = base ? now() + base : undefined;
    } else {
      failures++;
      const nominal = Math.min(cap, base * 2 ** Math.min(failures - 1, 20));
      const spread = nominal * 0.2 * Math.max(0, Math.min(1, random()));
      const hint = Number.isFinite(outcome.retryAfterMs) ? Math.max(0, outcome.retryAfterMs!) : 0;
      due = base ? now() + Math.min(cap, Math.max(base, nominal + spread, hint)) : undefined;
    }
    if (due !== undefined) schedule(due);
  }

  function requestSoon(defer = false) {
    pending = true;
    const earliest = Math.max(now(), lastStarted + minimumRetryGap);
    if (earliest <= now() && !defer) void run();
    else schedule(earliest);
  }

  const unsubscribe = lifecycle.subscribe(() => {
    const currentVersion = lifecycle.getVersion?.() ?? 0;
    const invalidated = currentVersion !== version;
    if (invalidated) {
      version = currentVersion;
      interrupted = true;
      if (active) {
        active.abort();
        active = undefined;
        onPause?.();
      }
    }
    if (!lifecycle.isEligible()) {
      clearTimer();
      if (active) {
        interrupted = true;
        active.abort();
        active = undefined;
        onPause?.();
      }
      return;
    }
    if (active || disposed) return;
    // Reopening access cannot repair unchanged terminal fetch inputs. Wait for
    // a saved input invalidation/remount or one deliberate manual attempt.
    if (terminalIdentityVersion === version) return;
    if (initial || interrupted || manual || pending) requestSoon(invalidated);
    else if (base) {
      if (due !== undefined && due <= now()) requestSoon();
      else if (failures > 0 && !lifecycleRetryUsed) {
        // One lifecycle shortcut per failure sequence. Focus storms cannot
        // continually bypass exponential backoff; explicit refresh is separate.
        lifecycleRetryUsed = true;
        requestSoon();
      } else if (due !== undefined) schedule(due);
    }
  });

  if (lifecycle.isEligible()) void run();

  return {
    refresh() {
      if (disposed || active) return; // join work already in progress
      terminalIdentityVersion = undefined;
      manual = true;
      if (lifecycle.isEligible()) requestSoon();
    },
    dispose() {
      disposed = true;
      unsubscribe();
      clearTimer();
      active?.abort();
      active = undefined;
    },
  };
}
