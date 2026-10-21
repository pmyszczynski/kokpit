// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { WidgetFetchTimeoutError } from "@/lib/fetchTimeout";
import * as fetchTimeout from "@/lib/fetchTimeout";
import {
  WidgetResultCache, widgetResultIdentity, WidgetCacheBusyError,
  WidgetCacheInvalidatedError, WidgetConsumerAbortedError,
} from "@/widgets/resultCache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function ready(options: ConstructorParameters<typeof WidgetResultCache>[0] = {}) {
  const cache = new WidgetResultCache(options);
  cache.observeGeneration("source-A");
  return cache;
}

afterEach(() => vi.useRealTimers());

describe("widgetResultIdentity", () => {
  it("canonicalizes nested object order while separating array order and credentials", () => {
    const first = widgetResultIdentity({ config: { api_key: "secret", fields: ["a", "b"] }, type: "plex" });
    expect(widgetResultIdentity({ type: "plex", config: { fields: ["a", "b"], api_key: "secret" } })).toBe(first);
    expect(widgetResultIdentity({ config: { api_key: "different", fields: ["a", "b"] }, type: "plex" })).not.toBe(first);
    expect(widgetResultIdentity({ config: { api_key: "secret", fields: ["b", "a"] }, type: "plex" })).not.toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("preserves an actual __proto__ JSON key rather than losing identity fields", () => {
    expect(widgetResultIdentity(JSON.parse('{"__proto__":{"value":1}}')))
      .not.toBe(widgetResultIdentity(JSON.parse('{"__proto__":{"value":2}}')));
    expect(widgetResultIdentity(JSON.parse('{"__proto__":{"value":1}}'))).not.toBe(widgetResultIdentity({}));
  });
});

describe("WidgetResultCache", () => {
  it("shares simultaneous work and immutable successful JSON snapshots", async () => {
    const cache = ready();
    const pending = deferred<{ count: number }>();
    const load = vi.fn(() => pending.promise);
    const first = cache.get("same", 30_000, load);
    const second = cache.get("same", 30_000, load);
    await Promise.resolve();
    expect(load).toHaveBeenCalledOnce();
    pending.resolve({ count: 7 });
    const firstData = await first as { count: number };
    firstData.count = 100;
    expect(await second).toEqual({ count: 7 });
    expect(await cache.get("same", 30_000, load)).toEqual({ count: 7 });
    expect(load).toHaveBeenCalledOnce();
  });

  it("starts TTL on completion and applies each caller's shorter freshness interval", async () => {
    let now = 0;
    const cache = ready({ now: () => now });
    const pending = deferred<unknown>();
    const load = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue({ newer: true });
    const first = cache.get("same", 30_000, load);
    await Promise.resolve();
    now = 20_000;
    pending.resolve({ original: true });
    await first;
    now = 20_999;
    expect(await cache.get("same", 1_000, load)).toEqual({ original: true });
    expect(load).toHaveBeenCalledOnce();
    now = 21_000;
    expect(await cache.get("same", 1_000, load)).toEqual({ newer: true });
    expect(load).toHaveBeenCalledTimes(2);
    now = 26_000;
    await cache.get("same", 30_000, load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("uses in-flight sharing only for interval zero, including after a cacheable caller", async () => {
    const cache = ready();
    const pending = deferred<unknown>();
    const load = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue({ number: 2 });
    const first = cache.get("same", 0, load);
    const joined = cache.get("same", 0, load);
    pending.resolve({ number: 1 });
    await Promise.all([first, joined]);
    expect(load).toHaveBeenCalledOnce();
    await cache.get("same", 0, load);
    expect(load).toHaveBeenCalledTimes(2);
    await cache.get("same", 30_000, load);
    expect(load).toHaveBeenCalledTimes(3);
    await cache.get("same", 0, load);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("preserves positive callers' fresh result during and after zero-only refreshes", async () => {
    let now = 0;
    const cache = ready({ now: () => now });
    const work = deferred<unknown>();
    const load = vi.fn().mockResolvedValueOnce({ number: 1 })
      .mockImplementationOnce(() => work.promise).mockResolvedValue({ number: 3 });
    await cache.get("same", 30_000, load);
    now = 1_000;
    const zero = cache.get("same", 0, load);
    const positive = cache.get("same", 30_000, load);
    const duringRefresh = await Promise.race([positive, Promise.resolve(Symbol("still pending"))]);
    work.resolve({ number: 2 });
    await Promise.all([zero, positive]);
    expect(duringRefresh).toEqual({ number: 1 });
    expect(await cache.get("same", 30_000, load)).toEqual({ number: 1 });
    expect(load).toHaveBeenCalledTimes(2);
    expect(await cache.get("same", 0, load)).toEqual({ number: 3 });
    expect(await cache.get("same", 30_000, load)).toEqual({ number: 1 });
    expect(load).toHaveBeenCalledTimes(3);
    // Zero-only work must not extend the original retained result's five seconds.
    now = 5_000;
    expect(await cache.get("same", 30_000, load)).toEqual({ number: 3 });
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("preserves longer callers' fresh result while a shorter refresh is pending and after it fails", async () => {
    let now = 0;
    const cache = ready({ now: () => now });
    const work = deferred<unknown>();
    const load = vi.fn().mockResolvedValueOnce({ original: true }).mockImplementationOnce(() => work.promise);
    await cache.get("same", 30_000, load);
    now = 1_000;
    const refresh = cache.get("same", 1_000, load);
    const failed = expect(refresh).rejects.toThrow("refresh failed");
    const positive = cache.get("same", 30_000, load);
    const duringRefresh = await Promise.race([positive, Promise.resolve(Symbol("still pending"))]);
    work.reject(new Error("refresh failed"));
    await failed;
    await positive.catch(() => undefined);
    expect(duringRefresh).toEqual({ original: true });
    expect(await cache.get("same", 30_000, load)).toEqual({ original: true });
    expect(load).toHaveBeenCalledTimes(2);
    const retry = vi.fn().mockRejectedValue(new Error("still failed"));
    await expect(cache.get("same", 1_000, retry)).rejects.toThrow("still failed");
    expect(retry).toHaveBeenCalledOnce();
    expect(await cache.get("same", 30_000, load)).toEqual({ original: true });
  });

  it("preserves a fresh result when a shorter refresh succeeds with an oversized nonretained payload", async () => {
    let now = 0;
    const cache = ready({ now: () => now, maxPayloadBytes: 5 });
    const load = vi.fn().mockResolvedValueOnce("abc").mockResolvedValue("😀");
    await cache.get("same", 30_000, load);
    now = 1_000;
    expect(await cache.get("same", 1_000, load)).toBe("😀");
    expect(await cache.get("same", 30_000, load)).toBe("abc");
    expect(load).toHaveBeenCalledTimes(2);
    expect(await cache.get("same", 1_000, load)).toBe("😀");
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("retains a zero-started refresh when a positive caller needs the newer result", async () => {
    let now = 0;
    const cache = ready({ now: () => now });
    const work = deferred<unknown>();
    const load = vi.fn().mockResolvedValueOnce({ original: true }).mockImplementationOnce(() => work.promise);
    await cache.get("same", 30_000, load);
    now = 1_000;
    const zero = cache.get("same", 0, load);
    const positive = cache.get("same", 1_000, load);
    work.resolve({ replacement: true });
    expect(await zero).toEqual({ replacement: true });
    expect(await positive).toEqual({ replacement: true });
    expect(await cache.get("same", 30_000, load)).toEqual({ replacement: true });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("replaces an existing result without double-counting bytes or evicting another fresh entry", async () => {
    let now = 0;
    const cache = ready({ now: () => now, maxEntries: 2, maxBytes: 10 });
    const loadA = vi.fn().mockResolvedValueOnce("abc").mockResolvedValue("xyz"); // Five JSON bytes each.
    const loadB = vi.fn(async () => "def");
    const loadC = vi.fn(async () => "ghi");
    await cache.get("a", 30_000, loadA);
    await cache.get("b", 30_000, loadB);
    await cache.get("a", 30_000, loadA); // a is most recent before replacement.
    now = 1_000;
    expect(await cache.get("a", 1_000, loadA)).toBe("xyz");
    expect(await cache.get("b", 30_000, loadB)).toBe("def");
    expect(loadB).toHaveBeenCalledOnce();
    expect(await cache.get("a", 30_000, loadA)).toBe("xyz");
    await cache.get("c", 30_000, loadC);
    expect(await cache.get("a", 30_000, loadA)).toBe("xyz");
    expect(loadA).toHaveBeenCalledTimes(2);
    await cache.get("b", 30_000, loadB);
    expect(loadB).toHaveBeenCalledTimes(2); // Only the later LRU insertion evicts b.
  });

  it("never caches failures or serves the expired result after a failed refresh", async () => {
    let now = 0;
    const cache = ready({ now: () => now });
    const load = vi.fn().mockResolvedValueOnce({ old: true }).mockRejectedValueOnce(new Error("failure"))
      .mockResolvedValue({ fresh: true });
    await cache.get("key", 30_000, load);
    now = 5_000;
    await expect(cache.get("key", 30_000, load)).rejects.toThrow("failure");
    expect(await cache.get("key", 30_000, load)).toEqual({ fresh: true });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("evicts settled entries by LRU and serialized byte accounting", async () => {
    const cache = ready({ maxEntries: 2, maxBytes: 10 });
    const load = vi.fn(async () => "abc"); // Five UTF-8 JSON bytes.
    await cache.get("a", 30_000, load);
    await cache.get("b", 30_000, load);
    await cache.get("a", 30_000, load); // a is now most recent.
    await cache.get("c", 30_000, load);
    await cache.get("a", 30_000, load);
    expect(load).toHaveBeenCalledTimes(3);
    await cache.get("b", 30_000, load);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("returns oversized successes without retaining them and counts UTF-8 bytes", async () => {
    const cache = ready({ maxPayloadBytes: 5 });
    const oversized = vi.fn(async () => "😀"); // Six JSON bytes, four UTF-16 units.
    expect(await cache.get("large", 30_000, oversized)).toBe("😀");
    await cache.get("large", 30_000, oversized);
    expect(oversized).toHaveBeenCalledTimes(2);
    const fits = vi.fn(async () => "abc");
    await cache.get("small", 30_000, fits);
    await cache.get("small", 30_000, fits);
    expect(fits).toHaveBeenCalledOnce();
  });

  it("caps total retained bytes independently of the entry count", async () => {
    const cache = ready({ maxEntries: 10, maxBytes: 5 });
    const load = vi.fn(async () => "abc");
    await cache.get("a", 30_000, load);
    await cache.get("b", 30_000, load);
    await cache.get("a", 30_000, load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("caps pending identities while allowing joins and releasing completed capacity", async () => {
    const cache = ready({ maxPending: 1 });
    const work = deferred<unknown>();
    const load = vi.fn(() => work.promise);
    const first = cache.get("a", 30_000, load);
    const joined = cache.get("a", 30_000, load);
    await expect(cache.get("b", 30_000, load)).rejects.toBeInstanceOf(WidgetCacheBusyError);
    expect(load).toHaveBeenCalledOnce();
    work.resolve({ value: 1 });
    await Promise.all([first, joined]);
    await expect(cache.get("b", 30_000, load)).resolves.toEqual({ value: 1 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("detaches one aborted consumer without cancelling another consumer's task", async () => {
    const cache = ready();
    const work = deferred<unknown>();
    let upstream: AbortSignal | undefined;
    const load = vi.fn((signal: AbortSignal) => { upstream = signal; return work.promise; });
    const local = new AbortController();
    const first = cache.get("a", 30_000, load, 5_000, local.signal);
    const second = cache.get("a", 30_000, load);
    await Promise.resolve();
    local.abort();
    await expect(first).rejects.toBeInstanceOf(WidgetConsumerAbortedError);
    expect(upstream?.aborted).toBe(false);
    work.resolve({ shared: true });
    expect(await second).toEqual({ shared: true });
    expect(load).toHaveBeenCalledOnce();
  });

  it("does not start work for an already-aborted consumer", async () => {
    const cache = ready();
    const controller = new AbortController();
    controller.abort();
    const load = vi.fn(async () => null);
    await expect(cache.get("a", 30_000, load, 5_000, controller.signal)).rejects.toBeInstanceOf(WidgetConsumerAbortedError);
    expect(load).not.toHaveBeenCalled();
  });

  it("invalidates settled data and blocks old completions from a returning source", async () => {
    const cache = ready();
    const old = deferred<unknown>();
    const initial = cache.get("a", 30_000, () => old.promise);
    const denied = expect(initial).rejects.toBeInstanceOf(WidgetCacheInvalidatedError);
    cache.observeGeneration("source-B");
    cache.observeGeneration("source-A");
    const fresh = vi.fn(async () => ({ fresh: true }));
    expect(await cache.get("a", 30_000, fresh)).toEqual({ fresh: true });
    old.resolve({ stale: true });
    await denied;
    expect(await cache.get("a", 30_000, fresh)).toEqual({ fresh: true });
    expect(fresh).toHaveBeenCalledOnce();
    cache.observeGeneration(null);
    await expect(cache.get("a", 30_000, fresh)).rejects.toBeInstanceOf(WidgetCacheInvalidatedError);
    cache.observeGeneration("source-A");
    await cache.get("a", 30_000, fresh);
    expect(fresh).toHaveBeenCalledTimes(2);
  });

  it("counts old-generation pending tasks against capacity until completion", async () => {
    const cache = ready({ maxPending: 1 });
    const work = deferred<unknown>();
    const first = cache.get("a", 30_000, () => work.promise);
    const denied = expect(first).rejects.toBeInstanceOf(WidgetCacheInvalidatedError);
    cache.observeGeneration("source-B");
    await expect(cache.get("a", 30_000, async () => null)).rejects.toBeInstanceOf(WidgetCacheBusyError);
    work.resolve(null);
    await denied;
    await expect(cache.get("a", 30_000, async () => 2)).resolves.toBe(2);
  });

  it("hard-times out shared consumers but holds capacity until ignored-abort work actually settles", async () => {
    vi.useFakeTimers();
    const cache = ready({ maxPending: 1 });
    const late = deferred<unknown>();
    let signal: AbortSignal | undefined;
    const load = vi.fn((value: AbortSignal) => { signal = value; return late.promise; });
    const first = cache.get("a", 30_000, load, 10);
    const joined = cache.get("a", 30_000, load, 10);
    const failed = expect(first).rejects.toBeInstanceOf(WidgetFetchTimeoutError);
    const joinedFailed = expect(joined).rejects.toBeInstanceOf(WidgetFetchTimeoutError);
    await vi.advanceTimersByTimeAsync(11);
    await Promise.all([failed, joinedFailed]);
    expect(signal?.aborted).toBe(true);
    expect(load).toHaveBeenCalledOnce();
    const newer = vi.fn(async () => ({ newer: true }));
    // Neither the timed-out identity nor a different one can exceed the raw-work cap.
    await expect(cache.get("a", 30_000, newer)).rejects.toBeInstanceOf(WidgetCacheBusyError);
    await expect(cache.get("b", 30_000, newer)).rejects.toBeInstanceOf(WidgetCacheBusyError);
    expect(newer).not.toHaveBeenCalled();
    late.resolve({ old: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(await cache.get("a", 30_000, newer)).toEqual({ newer: true });
    expect(await cache.get("a", 30_000, newer)).toEqual({ newer: true });
    expect(newer).toHaveBeenCalledOnce();
  });

  it.each(["resolve", "reject"] as const)("counts timed-out raw work across repeated generations until it %s", async settlement => {
    vi.useFakeTimers();
    const cache = ready({ maxPending: 1 });
    const work = deferred<unknown>();
    const load = vi.fn(() => work.promise);
    const first = cache.get("a", 30_000, load, 10);
    const failed = expect(first).rejects.toBeInstanceOf(WidgetFetchTimeoutError);
    await vi.advanceTimersByTimeAsync(11);
    await failed;
    const fresh = vi.fn(async () => ({ current: true }));
    for (const generation of ["source-B", "source-A", "source-C", "source-A"]) {
      cache.observeGeneration(generation);
      await expect(cache.get("a", 30_000, fresh)).rejects.toBeInstanceOf(WidgetCacheBusyError);
    }
    expect(fresh).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledOnce();
    if (settlement === "resolve") work.resolve({ obsolete: true });
    else work.reject(new Error("late upstream failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(await cache.get("a", 30_000, fresh)).toEqual({ current: true });
    expect(await cache.get("a", 30_000, fresh)).toEqual({ current: true });
    expect(fresh).toHaveBeenCalledOnce();
  });

  it("continues serving fresh successes while timed-out raw work holds all capacity", async () => {
    vi.useFakeTimers();
    const cache = ready({ now: () => 0, maxPending: 1 });
    const cached = vi.fn(async () => ({ cached: true }));
    await cache.get("cached", 30_000, cached);
    const work = deferred<unknown>();
    const first = cache.get("blocked", 0, () => work.promise, 10);
    const failed = expect(first).rejects.toBeInstanceOf(WidgetFetchTimeoutError);
    await vi.advanceTimersByTimeAsync(11);
    await failed;
    const fresh = vi.fn(async () => null);
    await expect(cache.get("other", 30_000, fresh)).rejects.toBeInstanceOf(WidgetCacheBusyError);
    expect(await cache.get("cached", 30_000, cached)).toEqual({ cached: true });
    expect(cached).toHaveBeenCalledOnce();
    expect(fresh).not.toHaveBeenCalled();
    work.resolve(null);
    await vi.advanceTimersByTimeAsync(0);
    await expect(cache.get("other", 30_000, fresh)).resolves.toBeNull();
  });

  it.each(["synchronous throw", "asynchronous rejection"])("releases capacity after a load's %s", async failure => {
    const cache = ready({ maxPending: 1 });
    const load = vi.fn(() => {
      if (failure === "synchronous throw") throw new Error("failed load");
      return Promise.reject(new Error("failed load"));
    });
    await expect(cache.get("a", 30_000, load)).rejects.toThrow("failed load");
    await expect(cache.get("b", 30_000, async () => 2)).resolves.toBe(2);
    expect(load).toHaveBeenCalledOnce();
  });

  it("releases cooperative cancellation once without undercounting later ignored-abort work", async () => {
    vi.useFakeTimers();
    const cache = ready({ maxPending: 1 });
    const cooperative = cache.get("cooperative", 0, signal => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("cancelled upstream")), { once: true });
    }), 10);
    const cooperativeFailed = cooperative.catch(error => error);
    await vi.advanceTimersByTimeAsync(11);
    expect(await cooperativeFailed).toBeInstanceOf(Error);
    const work = deferred<unknown>();
    const ignored = cache.get("ignored", 0, () => work.promise, 10);
    const ignoredFailed = expect(ignored).rejects.toBeInstanceOf(WidgetFetchTimeoutError);
    await vi.advanceTimersByTimeAsync(11);
    await ignoredFailed;
    const fresh = vi.fn(async () => null);
    await expect(cache.get("other", 0, fresh)).rejects.toBeInstanceOf(WidgetCacheBusyError);
    expect(fresh).not.toHaveBeenCalled();
    work.resolve(null);
    await vi.advanceTimersByTimeAsync(0);
    await expect(cache.get("other", 0, fresh)).resolves.toBeNull();
  });

  it("releases a reservation when the timeout wrapper rejects before invoking the load", async () => {
    const cache = ready({ maxPending: 1 });
    const wrapper = vi.spyOn(fetchTimeout, "fetchWithHardTimeout")
      .mockRejectedValueOnce(new WidgetFetchTimeoutError("before callback"));
    try {
      const load = vi.fn(async () => 1);
      await expect(cache.get("a", 30_000, load)).rejects.toBeInstanceOf(WidgetFetchTimeoutError);
      expect(load).not.toHaveBeenCalled();
      await expect(cache.get("b", 30_000, load)).resolves.toBe(1);
      expect(load).toHaveBeenCalledOnce();
    } finally {
      wrapper.mockRestore();
    }
  });
});
