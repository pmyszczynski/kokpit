import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { pushMock, refreshMock, resetNavigationMock } from "@/test/mocks/navigation";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import SessionRenewal from "@/components/SessionRenewal";

describe("SessionRenewal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetNavigationMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("retries a transient failure on a later online event", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionRenewal />);

    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => { window.dispatchEvent(new Event("online")); await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("redirects to login only when the refresh endpoint returns 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response));
    render(<SessionRenewal />);

    await act(async () => { await Promise.resolve(); });
    expect(pushMock).toHaveBeenCalledWith("/login");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("does not start a second refresh while the first is pending", async () => {
    let resolveRequest!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolveRequest = resolve; })));
    render(<SessionRenewal />);
    await act(async () => { window.dispatchEvent(new Event("online")); await Promise.resolve(); });
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => { resolveRequest({ ok: true, status: 200 } as Response); await Promise.resolve(); });
  });

  it("aborts a hung refresh so a future lifecycle event can retry", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }))
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionRenewal />);

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    await act(async () => { window.dispatchEvent(new Event("online")); await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
