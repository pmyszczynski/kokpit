import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeServiceStatus } from "@/lib/clientServiceStatus";
import { createBrowserPollingLifecycle } from "@/lib/clientPolling";

const observation = { ok: true, reachable: true, status: 200, checkedAt: 1000, responseTimeMs: 2 };
const cleanup: (() => void)[] = [];
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
afterEach(() => { cleanup.splice(0).forEach(dispose => dispose()); vi.unstubAllGlobals(); });

describe("browser status batching", () => {
  it("keeps duplicate subscribers on one active request until the last tile leaves", async () => {
    const lifecycle = createBrowserPollingLifecycle();
    let signal!: AbortSignal;
    const fetch = vi.fn((_url: string, options: { signal: AbortSignal }) => {
      signal = options.signal; return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetch);
    const first = subscribeServiceStatus("one", "same", lifecycle, vi.fn());
    await flush();
    const second = subscribeServiceStatus("one", "same", lifecycle, vi.fn());
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    first(); await flush(); expect(signal.aborted).toBe(false);
    second(); await flush(); expect(signal.aborted).toBe(true);
  });
  it("coalesces multiple and duplicate tiles into one saved-ID batch", async () => {
    const lifecycle = createBrowserPollingLifecycle();
    const fetch = vi.fn(async (url: string) => Response.json({ statuses: Object.fromEntries(new URL(url, "http://localhost").searchParams.get("ids")!.split(",").map(id => [id, observation])) }));
    vi.stubGlobal("fetch", fetch);
    const callbacks = Array.from({ length: 3 }, () => vi.fn());
    cleanup.push(subscribeServiceStatus("one", "destination", lifecycle, callbacks[0]),
      subscribeServiceStatus("two", "destination", lifecycle, callbacks[1]),
      subscribeServiceStatus("one", "destination", lifecycle, callbacks[2]));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(fetch.mock.calls[0][0], "http://localhost").searchParams.get("ids")).toBe("one,two");
    for (const callback of callbacks) expect(callback).toHaveBeenLastCalledWith({ observation: expect.objectContaining({ status: 200 }), unavailable: null });
  });
  it("bounds requests to twenty unique IDs and cleans up the shared browser request", async () => {
    const lifecycle = createBrowserPollingLifecycle();
    const requests: { ids: string[]; signal: AbortSignal }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: { signal: AbortSignal }) => {
      const ids = new URL(url, "http://localhost").searchParams.get("ids")!.split(",");
      requests.push({ ids, signal: options.signal });
      return Response.json({ statuses: Object.fromEntries(ids.map(id => [id, observation])) });
    }));
    for (let i = 0; i < 25; i++) cleanup.push(subscribeServiceStatus(String(i), "same", lifecycle, vi.fn()));
    await flush();
    expect(requests.map(request => request.ids.length)).toEqual([20, 5]);
    cleanup.splice(0).forEach(dispose => dispose());
    await flush();
    expect(requests).toHaveLength(2);
  });
});
