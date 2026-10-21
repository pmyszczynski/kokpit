import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserPollingLifecycle,
  retryAfterMilliseconds,
  startPolling,
  type PollingLifecycle,
  type PollOutcome,
} from "@/lib/clientPolling";

function lifecycle(initiallyEligible = true) {
  let eligible = initiallyEligible;
  const listeners = new Set<() => void>();
  const source = {
    isEligible: () => eligible,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reconcile: vi.fn(() => { eligible = false; source.emit(); }),
    emit() { for (const listener of listeners) listener(); },
    setEligible(value: boolean) { eligible = value; source.emit(); },
    listeners,
  };
  return source satisfies PollingLifecycle;
}

function deferred<T>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("completion-scheduled browser polling", () => {
  const subscriptions: ReturnType<typeof startPolling>[] = [];
  const poll = (options: Parameters<typeof startPolling>[0]) => {
    const subscription = startPolling(options);
    subscriptions.push(subscription);
    return subscription;
  };

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => {
    for (const subscription of subscriptions.splice(0)) subscription.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("allows a slow request to finish and schedules the next interval from completion", async () => {
    const first = deferred<PollOutcome>();
    const attempt = vi.fn<(signal: AbortSignal) => Promise<PollOutcome>>()
      .mockReturnValueOnce(first.promise).mockResolvedValue({ kind: "success" });
    const subscription = poll({ interval: 5000, lifecycle: lifecycle(), attempt });
    await vi.advanceTimersByTimeAsync(20_000);
    subscription.refresh();
    subscription.refresh();
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt.mock.calls[0][0].aborted).toBe(false);
    first.resolve({ kind: "success" });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4999);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("uses bounded exponential jitter and resets backoff only after success", async () => {
    const attempt = vi.fn<(signal: AbortSignal) => Promise<PollOutcome>>()
      .mockResolvedValueOnce({ kind: "failure" })
      .mockResolvedValueOnce({ kind: "failure" })
      .mockResolvedValueOnce({ kind: "success" })
      .mockResolvedValue({ kind: "failure" });
    poll({ interval: 1000, lifecycle: lifecycle(), attempt, random: () => 1 });
    await vi.advanceTimersByTimeAsync(1199);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2399);
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(attempt).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1199);
    expect(attempt).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(5);
  });

  it("caps retry hints/backoff without shortening a larger configured base", async () => {
    const attempt = vi.fn<(signal: AbortSignal) => Promise<PollOutcome>>()
      .mockResolvedValue({ kind: "failure", retryAfterMs: Number.MAX_SAFE_INTEGER });
    poll({ interval: 600_000, lifecycle: lifecycle(), attempt, random: () => 1 });
    await vi.advanceTimersByTimeAsync(599_999);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("does not overflow very long configured intervals into a rapid request loop", async () => {
    const attempt = vi.fn<(signal: AbortSignal) => Promise<PollOutcome>>()
      .mockResolvedValue({ kind: "success" });
    poll({ interval: 3_000_000_000, lifecycle: lifecycle(), attempt });
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000_000_000 - 2_147_483_647);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("does not treat intentional pause/abort as a failure or accept its late completion", async () => {
    const source = lifecycle();
    const first = deferred<PollOutcome>();
    const onPause = vi.fn();
    const attempt = vi.fn<(signal: AbortSignal) => Promise<PollOutcome>>()
      .mockReturnValueOnce(first.promise).mockResolvedValue({ kind: "success" });
    poll({ interval: 5000, lifecycle: source, attempt, onPause });
    source.setEligible(false);
    expect(attempt.mock.calls[0][0].aborted).toBe(true);
    expect(onPause).toHaveBeenCalledTimes(1);
    first.resolve({ kind: "failure" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempt).toHaveBeenCalledTimes(1);
    source.setEligible(true);
    source.emit();
    source.emit();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("coalesces event bursts and permits only one lifecycle shortcut in a failure sequence", async () => {
    const source = lifecycle();
    const attempt = vi.fn<(signal: AbortSignal) => Promise<PollOutcome>>()
      .mockResolvedValue({ kind: "failure" });
    const subscription = poll({ interval: 30_000, lifecycle: source, attempt, random: () => 0 });
    await vi.advanceTimersByTimeAsync(100);
    for (let i = 0; i < 30; i++) source.emit();
    await vi.advanceTimersByTimeAsync(899);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 10; i++) {
      source.emit();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(attempt).toHaveBeenCalledTimes(2);
    subscription.refresh();
    subscription.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("keeps interval-zero subscriptions manual after their initial request", async () => {
    const source = lifecycle(false);
    const attempt = vi.fn<(signal: AbortSignal) => Promise<PollOutcome>>()
      .mockResolvedValue({ kind: "success" });
    const subscription = poll({ interval: 0, lifecycle: source, attempt });
    expect(attempt).not.toHaveBeenCalled();
    source.setEligible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);
    source.emit();
    source.setEligible(false);
    await vi.advanceTimersByTimeAsync(600_000);
    source.setEligible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(1);
    source.setEligible(false);
    subscription.refresh();
    subscription.refresh();
    source.setEligible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("resumes an interrupted initial interval-zero request", async () => {
    const source = lifecycle();
    const first = deferred<PollOutcome>();
    const attempt = vi.fn<(signal: AbortSignal) => Promise<PollOutcome>>()
      .mockReturnValueOnce(first.promise).mockResolvedValue({ kind: "success" });
    poll({ interval: 0, lifecycle: source, attempt });
    source.setEligible(false);
    source.setEligible(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(attempt).toHaveBeenCalledTimes(2);
    first.resolve({ kind: "failure" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("asks the access owner to reconcile terminal outcomes and waits for its gate", async () => {
    const source = lifecycle();
    const attempt = vi.fn<(signal: AbortSignal) => Promise<PollOutcome>>()
      .mockResolvedValueOnce({ kind: "reconcile", reason: { kind: "authorization", status: 401 } })
      .mockResolvedValue({ kind: "success" });
    poll({ interval: 5000, lifecycle: source, attempt });
    await vi.advanceTimersByTimeAsync(60_000);
    source.emit();
    expect(source.reconcile).toHaveBeenCalledWith({ kind: "authorization", status: 401 });
    expect(attempt).toHaveBeenCalledTimes(1);
    source.setEligible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("quarantines unchanged terminal identities until effective input invalidation or deliberate refresh", async () => {
    let version = 0;
    const base = lifecycle();
    const source = { ...base, getVersion: () => version };
    const attempt = vi.fn<(signal: AbortSignal) => Promise<PollOutcome>>()
      .mockResolvedValue({ kind: "reconcile", reason: { kind: "identity", status: 400 } });
    const subscription = poll({ interval: 1000, lifecycle: source, attempt });
    await vi.advanceTimersByTimeAsync(0);
    source.setEligible(true); await vi.advanceTimersByTimeAsync(60_000);
    expect(attempt).toHaveBeenCalledTimes(1);
    version++; source.emit(); await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledTimes(2);
    source.setEligible(true); subscription.refresh(); await vi.advanceTimersByTimeAsync(1000);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("removes listeners/timeouts and aborts only its own subscription on disposal", async () => {
    const source = lifecycle();
    const first = vi.fn<(signal: AbortSignal) => Promise<PollOutcome>>().mockReturnValue(new Promise(() => {}));
    const second = vi.fn<(signal: AbortSignal) => Promise<PollOutcome>>().mockReturnValue(new Promise(() => {}));
    const subscription = poll({ interval: 5000, lifecycle: source, attempt: first });
    poll({ interval: 5000, lifecycle: source, attempt: second });
    subscription.dispose();
    expect(first.mock.calls[0][0].aborted).toBe(true);
    expect(second.mock.calls[0][0].aborted).toBe(false);
    expect(source.listeners.size).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(first).toHaveBeenCalledTimes(1);
  });
});

describe("browser lifecycle source", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shares one set of browser listeners and gates resume before notifying consumers", () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const source = createBrowserPollingLifecycle();
    const seen: boolean[] = [];
    const first = source.subscribe(() => seen.push(source.isEligible()));
    const second = source.subscribe(() => seen.push(source.isEligible()));
    expect(add.mock.calls.filter(([type]) => type === "visibilitychange")).toHaveLength(1);
    source.setBeforeResume(() => source.setAccessAllowed(false));
    window.dispatchEvent(new Event("focus"));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(value => value === false)).toBe(true);
    source.setAccessAllowed(true);
    expect(seen.slice(-2)).toEqual([true, true]);
    first();
    expect(remove.mock.calls.filter(([type]) => type === "visibilitychange")).toHaveLength(0);
    second();
    expect(remove.mock.calls.filter(([type]) => type === "visibilitychange")).toHaveLength(1);
  });

  it("requires both a visible document and no explicit offline signal", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const source = createBrowserPollingLifecycle();
    expect(source.isEligible()).toBe(false);
    visibility.mockReturnValue("visible");
    online.mockReturnValue(false);
    expect(source.isEligible()).toBe(false);
    online.mockReturnValue(true);
    expect(source.isEligible()).toBe(true);
  });
});

describe("Retry-After parsing", () => {
  it("bounds valid guidance and ignores malformed, negative or expired values", () => {
    const now = Date.UTC(2026, 9, 20);
    expect(retryAfterMilliseconds("20", now)).toBe(20_000);
    expect(retryAfterMilliseconds(new Date(now + 10_000).toUTCString(), now)).toBe(10_000);
    expect(retryAfterMilliseconds("99999999999", now)).toBe(300_000);
    for (const value of [null, "", "bad", "-1", "Infinity", new Date(now - 1000).toUTCString()]) {
      expect(retryAfterMilliseconds(value, now)).toBeUndefined();
    }
  });
});
