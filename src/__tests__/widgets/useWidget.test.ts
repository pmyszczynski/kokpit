import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWidget } from "@/widgets/useWidget";
import { createElement, type PropsWithChildren } from "react";
import { PollingLifecycleProvider } from "@/components/PollingLifecycle";
import { createBrowserPollingLifecycle } from "@/lib/clientPolling";
import { ConfigurationSyncProvider } from "@/components/ConfigurationSyncProvider";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function pollingWrapper(source: ReturnType<typeof createBrowserPollingLifecycle>) {
  return function PollingTestWrapper({ children }: PropsWithChildren) {
    return createElement(PollingLifecycleProvider, { value: source }, children);
  };
}

describe("useWidget", () => {
  it("clears a previous target's payload when the effective fetch generation changes and the new target fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let revision = "one";
    let dataRevision = "opaque-fetch-one";
    let widgetCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (!url.startsWith("/api/widget?")) return Response.json({ revision, editable: true });
      widgetCalls++;
      return widgetCalls === 1 ? Response.json({ ok: true, data: "previous-target" })
        : Response.json({ ok: false, error: "New target unavailable" }, { status: 502 });
    }));
    const wrapper = ({ children }: PropsWithChildren) => createElement(ConfigurationSyncProvider, {
      initialRevision: revision, initialEditable: true, initialDataRevision: dataRevision,
      initialAppearance: { theme: "dark", customCss: undefined, bgStyle: {} },
    } as Parameters<typeof ConfigurationSyncProvider>[0], children);
    const { result, rerender } = renderHook(() => useWidget("same-tile", 0, "sonarr-calendar", "3x2"), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.data).toBe("previous-target");
    revision = "two";
    dataRevision = "opaque-fetch-two";
    rerender();
    await act(async () => { await vi.advanceTimersByTimeAsync(1001); });
    expect(widgetCalls).toBe(2);
    expect(result.current).toMatchObject({ data: null, error: "New target unavailable", loading: false });
  });

  it("retains a successful payload without another request when only the cosmetic revision changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let revision = "one";
    let widgetCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (!url.startsWith("/api/widget?")) return Response.json({ revision, editable: true });
      widgetCalls++;
      return Response.json({ ok: true, data: "retained-target" });
    }));
    const wrapper = ({ children }: PropsWithChildren) => createElement(ConfigurationSyncProvider, {
      initialRevision: revision, initialEditable: true, initialDataRevision: "same-effective-fetch-inputs",
      initialAppearance: { theme: revision === "one" ? "dark" : "light", customCss: undefined, bgStyle: {} },
    } as Parameters<typeof ConfigurationSyncProvider>[0], children);
    const { result, rerender } = renderHook(() => useWidget("same-tile", 0, "sonarr-calendar", "3x2"), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.data).toBe("retained-target");
    revision = "two";
    rerender();
    await act(async () => { await vi.advanceTimersByTimeAsync(1001); });
    expect(result.current).toMatchObject({ data: "retained-target", error: null, loading: false });
    expect(widgetCalls).toBe(1);
  });

  it("aborts and ignores an older response after its fetch identity changes", async () => {
    let resolveOld!: (value: unknown) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ json: async () => ({ ok: true, data: "detailed" }) });
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ identity }) => useWidget("same-tile", 0, "system-stats", identity),
      { initialProps: { identity: "3x2" } });
    rerender({ identity: "3x4" });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    await waitFor(() => expect(result.current.data).toBe("detailed"));
    await act(async () => resolveOld({ json: async () => ({ ok: true, data: "compact" }) }));
    expect(result.current.data).toBe("detailed");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("starts in loading state", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise(() => {})) // never resolves
    );
    const { result } = renderHook(() => useWidget("tile-id"));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("resolves data on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true, data: { value: 42 } }),
      } as Response)
    );

    const { result } = renderHook(() => useWidget<{ value: number }>("tile-id"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual({ value: 42 });
    expect(result.current.error).toBeNull();
  });

  it("sets error on failed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: false, error: "Service unreachable" }),
      } as Response)
    );

    const { result } = renderHook(() => useWidget("tile-id"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("Service unreachable");
  });

  it("sets error on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error"))
    );

    const { result } = renderHook(() => useWidget("tile-id"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Network error");
  });

  it("re-fetches on the configured refresh interval", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: {} }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useWidget("tile-id", 5_000));

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts in-flight fetch on unmount", () => {
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
        capturedSignal = opts.signal as AbortSignal;
        return new Promise(() => {});
      })
    );

    const { unmount } = renderHook(() => useWidget("tile-id"));
    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("re-fetches when the widget type changes", async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
      signals.push(options.signal as AbortSignal);
      return new Promise(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderHook(
      ({ tileId, widgetType }) => useWidget(tileId, undefined, widgetType),
      {
        initialProps: { tileId: "tile-id", widgetType: "sonarr-calendar" },
      }
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/widget?tile_id=tile-id&widget_type=sonarr-calendar");

    act(() => {
      rerender({ tileId: "tile-id", widgetType: "sonarr-queue" });
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(signals[0].aborted).toBe(true);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/widget?tile_id=tile-id&widget_type=sonarr-queue");
  });

  it("clears the previous result when the tile or widget identity changes", async () => {
    let resolveNext: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true, data: { widget: "old" } }),
      } as Response)
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveNext = resolve; }));
    vi.stubGlobal("fetch", fetchMock);

    const { result, rerender } = renderHook(
      ({ tileId, widgetType }) => useWidget<{ widget: string }>(tileId, undefined, widgetType),
      { initialProps: { tileId: "old-tile", widgetType: "sonarr-calendar" } }
    );
    await waitFor(() => expect(result.current.data).toEqual({ widget: "old" }));

    rerender({ tileId: "new-tile", widgetType: "sonarr-queue" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBeNull();

    await act(async () => {
      resolveNext?.({ json: () => Promise.resolve({ ok: true, data: { widget: "new" } }) } as Response);
    });
    await waitFor(() => expect(result.current.data).toEqual({ widget: "new" }));
  });

  it("pauses hidden requests without erasing stale data and ignores the aborted response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const source = createBrowserPollingLifecycle();
    let resolveLate!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, data: "saved" }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveLate = resolve; }))
      .mockResolvedValue(Response.json({ ok: true, data: "current" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWidget("tile", 5000), { wrapper: pollingWrapper(source) });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.data).toBe("saved");
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    act(() => {
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
    expect(result.current).toMatchObject({ data: "saved", loading: false, error: null });
    await act(async () => {
      resolveLate(Response.json({ ok: true, data: "obsolete" }));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current.data).toBe("saved");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    act(() => {
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.data).toBe("current");
  });

  it("keeps stale data and its error while paused after a failed refresh", async () => {
    vi.useFakeTimers();
    const source = createBrowserPollingLifecycle();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, data: "saved" }))
      .mockResolvedValue(Response.json({ ok: false, error: "Upstream unavailable" }, { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWidget("tile", 5000), { wrapper: pollingWrapper(source) });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current).toMatchObject({ data: "saved", error: "Upstream unavailable", loading: false });
    act(() => source.setAccessAllowed(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(result.current).toMatchObject({ data: "saved", error: "Upstream unavailable", loading: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retains a previous refresh error through an interrupted retry until a real success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const source = createBrowserPollingLifecycle();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, data: "saved" }))
      .mockResolvedValueOnce(Response.json({ ok: false, error: "Previous upstream failure" }, { status: 502 }))
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce(Response.json({ ok: true, data: "recovered" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWidget("tile", 5000), { wrapper: pollingWrapper(source) });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current).toMatchObject({ data: "saved", error: "Previous upstream failure", loading: true });
    act(() => source.setAccessAllowed(false));
    expect(fetchMock.mock.calls[2][1].signal.aborted).toBe(true);
    expect(result.current).toMatchObject({ data: "saved", error: "Previous upstream failure", loading: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      source.setAccessAllowed(true);
    });
    expect(result.current).toMatchObject({ data: "recovered", error: null, loading: false });
  });

  it("does not request data while mounted hidden or explicitly offline", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const source = createBrowserPollingLifecycle();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, data: "online" }));
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useWidget("tile", 5000), { wrapper: pollingWrapper(source) });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => {
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => {
      online.mockReturnValue(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404, 409])("reconciles terminal Kokpit status %i without polling obsolete access/identity forever", async status => {
    vi.useFakeTimers();
    const source = createBrowserPollingLifecycle();
    const reconcile = vi.fn();
    source.setReconciliationHandler(reconcile);
    const fetchMock = vi.fn().mockResolvedValue(new Response("not JSON", { status }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWidget("tile", 5000), { wrapper: pollingWrapper(source) });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(reconcile).toHaveBeenCalledWith({ kind: status === 401 || status === 403 ? "authorization" : "identity", status });
    expect(result.current.loading).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors bounded Retry-After guidance without clearing previous data", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const source = createBrowserPollingLifecycle();
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ ok: true, data: "retained payload" })).mockResolvedValue({
      ok: false, status: 429, headers: new Headers({ "Retry-After": "120" }),
      json: async () => ({ ok: false, error: "Busy" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWidget("tile", 5000), { wrapper: pollingWrapper(source) });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.data).toBe("retained payload");
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current).toMatchObject({ data: "retained payload", error: "Busy", loading: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(119_999); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe("retained payload");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current).toMatchObject({ data: "retained payload", error: "Busy", loading: false });
  });

  it("retains payload when only the refresh interval changes", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, data: "retained" }))
      .mockReturnValue(new Promise(() => {})));
    const source = createBrowserPollingLifecycle();
    const { result, rerender } = renderHook(({ interval }) => useWidget("tile", interval), {
      initialProps: { interval: 5000 }, wrapper: pollingWrapper(source),
    });
    await waitFor(() => expect(result.current.data).toBe("retained"));
    rerender({ interval: 10_000 });
    expect(result.current.data).toBe("retained");
  });

  it("cleans up Strict Mode's first subscription and ignores its late result", async () => {
    let resolveOld!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce(Response.json({ ok: true, data: "strict-current" }));
    vi.stubGlobal("fetch", fetchMock);
    const source = createBrowserPollingLifecycle();
    const { result, unmount } = renderHook(() => useWidget("tile", 5000), {
      wrapper: pollingWrapper(source), reactStrictMode: true,
    });
    await waitFor(() => expect(result.current.data).toBe("strict-current"));
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => resolveOld(Response.json({ ok: true, data: "strict-obsolete" })));
    expect(result.current.data).toBe("strict-current");
    unmount();
  });

  it("coalesces explicit configuration invalidation and refreshes interval-zero saved options once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const source = createBrowserPollingLifecycle();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, data: "old-options" }))
      .mockResolvedValueOnce(Response.json({ ok: true, data: "new-options" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWidget("tile", 0), { wrapper: pollingWrapper(source) });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    act(() => {
      source.invalidate();
      source.invalidate();
      source.invalidate();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe("new-options");
    act(() => window.dispatchEvent(new Event("focus")));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries temporary widget configuration unavailability with unchanged identity and Retry-After", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const source = createBrowserPollingLifecycle();
    const reconcile = vi.fn();
    source.setReconciliationHandler(reconcile);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, data: "saved payload" }))
      .mockResolvedValueOnce(Response.json({ ok: false, code: "config_unavailable", error: "Temporary configuration update" }, { status: 409, headers: { "Retry-After": "120" } }))
      .mockResolvedValueOnce(Response.json({ ok: true, data: "recovered payload" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWidget("same-tile", 5000, "same-type", "same-footprint"), { wrapper: pollingWrapper(source) });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    const generation = source.getVersion();
    expect(result.current.data).toBe("saved payload");
    act(() => source.setAccessAllowed(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(119_999); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe("saved payload");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current).toMatchObject({ data: "recovered payload", error: null, loading: false });
    expect(source.getVersion()).toBe(generation);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("preserves an existing widget error through temporary configuration conflicts until a real success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const source = createBrowserPollingLifecycle();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, data: "saved payload" }))
      .mockResolvedValueOnce(Response.json({ ok: false, error: "Previous upstream failure" }, { status: 502 }))
      .mockResolvedValueOnce(Response.json({ ok: false, code: "config_unavailable", error: "Temporary configuration update" }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ ok: true, data: "recovered payload" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWidget("same-tile", 5000), { wrapper: pollingWrapper(source) });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current).toMatchObject({ data: "saved payload", error: "Previous upstream failure", loading: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(9999); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.current).toMatchObject({ data: "recovered payload", error: null, loading: false });
  });

  it("keeps interval-zero temporary widget conflicts manual without permanently closing access", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const source = createBrowserPollingLifecycle();
    const reconcile = vi.fn();
    source.setReconciliationHandler(reconcile);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: false, code: "config_unavailable", error: "Temporary configuration update" }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ ok: true, data: "manual recovery" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWidget("same-tile", 0), { wrapper: pollingWrapper(source) });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(source.isEligible()).toBe(true);
    expect(result.current).toMatchObject({ data: null, error: null, loading: false });
    act(() => result.current.refresh());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe("manual recovery");
    expect(reconcile).not.toHaveBeenCalled();
  });

  it.each([
    [400, "config_unavailable"],
    [409, undefined],
    [409, "widget_type_changed"],
  ])("keeps unknown/type-changed and other identity failures terminal (status %i, code %s)", async (status, code) => {
    vi.useFakeTimers();
    const source = createBrowserPollingLifecycle();
    const reconcile = vi.fn();
    source.setReconciliationHandler(reconcile);
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: false, code, error: "Widget identity changed" }, { status }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWidget("same-tile", 5000), { wrapper: pollingWrapper(source) });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(result.current.error).toBe("Widget identity changed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith({ kind: "identity", status });
  });

});
