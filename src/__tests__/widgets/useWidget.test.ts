import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWidget } from "@/widgets/useWidget";

describe("useWidget", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts in loading state", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise(() => {})) // never resolves
    );
    const { result } = renderHook(() => useWidget("test", "TestService"));
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

    const { result } = renderHook(() => useWidget<{ value: number }>("test", "TestService"));

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

    const { result } = renderHook(() => useWidget("test", "TestService"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("Service unreachable");
  });

  it("sets error on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error"))
    );

    const { result } = renderHook(() => useWidget("test", "TestService"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Network error");
  });

  it("re-fetches on the configured refresh interval", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: {} }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useWidget("test", "TestService", 5_000));

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
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

    const { unmount } = renderHook(() => useWidget("test", "TestService"));
    unmount();

    expect(capturedSignal?.aborted).toBe(true);
  });
});
