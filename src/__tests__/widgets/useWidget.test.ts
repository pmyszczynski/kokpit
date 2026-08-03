import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWidget } from "@/widgets/useWidget";

describe("useWidget", () => {
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
});
