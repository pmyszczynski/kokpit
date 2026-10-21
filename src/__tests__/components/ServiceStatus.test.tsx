import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ServiceStatus } from "@/components/ServiceStatus";
import { PollingLifecycleProvider } from "@/components/PollingLifecycle";
import { createBrowserPollingLifecycle } from "@/lib/clientPolling";
import { ConfigurationSyncProvider } from "@/components/ConfigurationSyncProvider";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const NOW = Date.UTC(2026, 9, 20, 12);
const observed = (status: number) => ({ ok: true, reachable: true, status, checkedAt: NOW - 5000, responseTimeMs: 42.5 });

function mount() {
  const lifecycle = createBrowserPollingLifecycle();
  const view = render(<PollingLifecycleProvider value={lifecycle}><ServiceStatus serviceId="saved-service" /></PollingLifecycleProvider>);
  return { ...view, lifecycle };
}

describe("service reachability feedback", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); vi.spyOn(Math, "random").mockReturnValue(0); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it.each([
    [200, "ok", "Reachable; HTTP 200"],
    [302, "warning", "Reachable; redirect returned; application health unknown; HTTP 302"],
    [401, "warning", "Reachable; authentication required; HTTP 401"],
    [403, "warning", "Reachable; access restricted; HTTP 403"],
    [404, "warning", "Reachable; HTTP error; application health unknown; HTTP 404"],
    [405, "warning", "Reachable; HEAD unsupported; application health unknown; HTTP 405"],
    [500, "degraded", "Reachable; degraded (HTTP server error); HTTP 500"],
    [501, "warning", "Reachable; HEAD unsupported; application health unknown; HTTP 501"],
    [503, "degraded", "Reachable; degraded (HTTP server error); HTTP 503"],
  ])("explains HTTP %i with a textual assessment and %s styling", async (status, tone, assessment) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(observed(status as number))));
    await act(async () => { mount(); });
    const indicator = screen.getByRole("img");
    expect(indicator).toHaveClass(`status-dot--${tone}`);
    expect(indicator.getAttribute("aria-label")).toContain(assessment as string);
    expect(indicator.getAttribute("aria-label")).toContain("42.5 ms to headers");
    expect(indicator.getAttribute("aria-label")).toContain("5s ago");
    expect(indicator).toHaveAttribute("tabindex", "0");
  });

  it("distinguishes a confirmed unreachable probe from ambiguous legacy/checker failures", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: false, reachable: false, assessment: "unreachable", reason: "timeout", checkedAt: NOW, responseTimeMs: 5000 }))
      .mockResolvedValueOnce(Response.json({ ok: false }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => { mount(); });
    expect(screen.getByRole("img")).toHaveClass("status-dot--error");
    expect(screen.getByRole("img")).toHaveAccessibleName(/Unreachable from Kokpit; probe timed out; 5000 ms probe elapsed/);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("img")).toHaveClass("status-dot--unavailable");
    expect(screen.getByRole("img")).toHaveAccessibleName(/^Status unavailable; status checker returned an invalid response. Last observation: Unreachable from Kokpit/);
  });

  it.each([400, 401, 403, 404])("shows unavailable for Kokpit HTTP %i, preserving the last service observation", async status => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json(observed(200)))
      .mockResolvedValueOnce(new Response("private backend details", { status })));
    let lifecycle!: ReturnType<typeof createBrowserPollingLifecycle>;
    const reconcile = vi.fn();
    await act(async () => { ({ lifecycle } = mount()); lifecycle.setReconciliationHandler(reconcile); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    const indicator = screen.getByRole("img");
    expect(indicator).toHaveClass("status-dot--unavailable");
    expect(indicator).toHaveAccessibleName(/^Status unavailable/);
    expect(indicator.getAttribute("aria-label")).toContain("Last observation: Reachable; HTTP 200");
    expect(indicator.getAttribute("aria-label")).not.toContain("private backend details");
    expect(reconcile).toHaveBeenCalledWith({ kind: status === 401 || status === 403 ? "authorization" : "identity", status });
  });

  it.each([false, true])("automatically retries a temporary configuration conflict without a generation change (prior observation: %s)", async (hasObservation) => {
    const fetchMock = vi.fn();
    if (hasObservation) fetchMock.mockResolvedValueOnce(Response.json(observed(200)));
    fetchMock.mockResolvedValueOnce(new Response("Configuration is being updated", { status: 409 }))
      .mockResolvedValue(Response.json(observed(200)));
    vi.stubGlobal("fetch", fetchMock);
    let lifecycle!: ReturnType<typeof createBrowserPollingLifecycle>;
    const reconcile = vi.fn();
    await act(async () => { ({ lifecycle } = mount()); lifecycle.setReconciliationHandler(reconcile); });
    if (hasObservation) await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    const indicator = screen.getByRole("img");
    expect(indicator).toHaveClass("status-dot--unavailable");
    expect(indicator).toHaveAccessibleName(/^Status unavailable; saved configuration changed/);
    if (hasObservation) expect(indicator).toHaveAccessibleName(/Last observation: Reachable; HTTP 200/);
    else expect(indicator.getAttribute("aria-label")).not.toContain("Last observation");
    const generation = lifecycle.getVersion();
    const attempts = hasObservation ? 2 : 1;
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(fetchMock).toHaveBeenCalledTimes(attempts);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(attempts + 1);
    expect(indicator).toHaveAccessibleName(/^Reachable; HTTP 200/);
    expect(lifecycle.getVersion()).toBe(generation);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it.each([false, true])("resumes after the polling gate closes and reopens with unchanged inputs (prior observation: %s)", async (hasObservation) => {
    const fetchMock = vi.fn();
    if (hasObservation) fetchMock.mockResolvedValueOnce(Response.json(observed(200)));
    fetchMock.mockResolvedValueOnce(new Response("Configuration is being updated", { status: 409 }))
      .mockResolvedValue(Response.json(observed(200)));
    vi.stubGlobal("fetch", fetchMock);
    let lifecycle!: ReturnType<typeof createBrowserPollingLifecycle>;
    const reconcile = vi.fn();
    await act(async () => { ({ lifecycle } = mount()); lifecycle.setReconciliationHandler(reconcile); });
    if (hasObservation) await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    const generation = lifecycle.getVersion();
    const attempts = hasObservation ? 2 : 1;
    act(() => lifecycle.setAccessAllowed(false));
    expect(lifecycle.isEligible()).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(fetchMock).toHaveBeenCalledTimes(attempts);
    expect(screen.getByRole("img")).toHaveAccessibleName(/^Status unavailable; saved configuration changed/);
    if (hasObservation) expect(screen.getByRole("img")).toHaveAccessibleName(/Last observation: Reachable; HTTP 200/);
    else expect(screen.getByRole("img").getAttribute("aria-label")).not.toContain("Last observation");
    act(() => lifecycle.setAccessAllowed(true));
    expect(lifecycle.isEligible()).toBe(true);
    // Access reopening permits one retry after the minimum one-second gap.
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(fetchMock).toHaveBeenCalledTimes(attempts);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(attempts + 1);
    expect(screen.getByRole("img")).toHaveAccessibleName(/^Reachable; HTTP 200/);
    expect(lifecycle.getVersion()).toBe(generation);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("honors Retry-After on temporary configuration conflicts without inferring an outage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Configuration is being updated", {
      status: 409, headers: { "Retry-After": "120" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const reconcile = vi.fn();
    await act(async () => { const { lifecycle } = mount(); lifecycle.setReconciliationHandler(reconcile); });
    await act(async () => { await vi.advanceTimersByTimeAsync(119_999); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("img")).toHaveClass("status-dot--unavailable");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("img")).toHaveAccessibleName(/^Status unavailable; saved configuration changed/);
    expect(screen.getByRole("img").getAttribute("aria-label")).not.toMatch(/Offline|Unreachable from Kokpit/);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it.each([
    Response.json({ ok: false, reachable: null, assessment: "unavailable", reason: "capacity", checkedAt: NOW, responseTimeMs: null }),
    Response.json({ ok: false, reachable: null, assessment: "unavailable", reason: "probe-blocked", checkedAt: NOW, responseTimeMs: null }),
    new Response("temporary checker error", { status: 503 }),
    new Response("invalid JSON", { status: 200 }),
  ])("keeps checker/capacity/invalid-response failures neutral %#", async response => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await act(async () => { mount(); });
    expect(screen.getByRole("img")).toHaveClass("status-dot--unavailable");
    expect(screen.getByRole("img")).toHaveAccessibleName(/^Status unavailable/);
    expect(screen.getByRole("img").getAttribute("aria-label")).not.toContain("Offline");
  });

  it("opens a keyboard-readable tooltip, updates observation age, and dismisses with Escape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(observed(401))));
    let unmount!: () => void;
    await act(async () => { ({ unmount } = mount()); });
    fireEvent.focus(screen.getByRole("img"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("HTTP 401; 42.5 ms to headers");
    expect(screen.getByRole("img")).toHaveAccessibleDescription(/HTTP 401; 42.5 ms to headers/);
    expect(screen.getByRole("tooltip")).toHaveTextContent("5s ago");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole("tooltip")).toHaveTextContent("6s ago");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reuses a surrounding launch link's keyboard stop instead of nesting tabindex", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(observed(200))));
    await act(async () => render(<a href="https://example.com">Launch service <ServiceStatus serviceId="saved-service" insideLink /></a>));
    expect(screen.getByRole("img")).not.toHaveAttribute("tabindex");
    fireEvent.focus(screen.getByRole("link"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Reachable; HTTP 200");
  });

  it("describes a launch link that received focus before its indicator mounted", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(observed(401))));
    const view = render(<a href="https://example.com" aria-label="Focused service">Launch service</a>);
    const link = screen.getByRole("link", { name: "Focused service" });
    act(() => link.focus());
    await act(async () => view.rerender(
      <a href="https://example.com" aria-label="Focused service">Launch service <ServiceStatus serviceId="saved-service" insideLink /></a>
    ));
    expect(link).toHaveFocus();
    expect(link).toHaveAccessibleDescription(/Reachable; authentication required; HTTP 401/);
    expect(screen.getByRole("tooltip")).toHaveTextContent("HTTP 401");
  });

  it("describes an aria-labeled compact launch link and preserves other descriptions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(observed(401))));
    await act(async () => render(<>
      <span id="launch-help">Opens a new tab</span>
      <a href="https://example.com" aria-label="Compact service" aria-describedby="launch-help">
        <ServiceStatus serviceId="saved-service" insideLink />
      </a>
    </>));
    const link = screen.getByRole("link", { name: "Compact service" });
    fireEvent.focus(link);
    expect(link).toHaveAccessibleDescription(/Opens a new tab Reachable; authentication required; HTTP 401/);
    const tooltipId = screen.getByRole("tooltip").id;
    expect(link.getAttribute("aria-describedby")?.split(" ")).toEqual(["launch-help", tooltipId]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(link).toHaveAttribute("aria-describedby", "launch-help");
    fireEvent.blur(link);
    fireEvent.focus(link);
    expect(link.getAttribute("aria-describedby")?.split(" ")).toEqual(["launch-help", tooltipId]);
    fireEvent.blur(link);
    expect(link).toHaveAttribute("aria-describedby", "launch-help");
  });

  it("keeps status tooltips inside the access gate and clears them after authorization loss", async () => {
    let revisionStatus = 200;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/ping"
      ? Response.json(observed(200))
      : revisionStatus === 200
        ? Response.json({ revision: "one", editable: true, dataRevision: "data-one" })
        : new Response("{}", { status: revisionStatus })));
    await act(async () => render(<ConfigurationSyncProvider initialRevision="one" initialEditable
      initialAppearance={{ theme: "dark", customCss: undefined, bgStyle: {} }} initialDataRevision="data-one">
      <ServiceStatus serviceId="saved-service" />
    </ConfigurationSyncProvider>));
    fireEvent.focus(screen.getByRole("img"));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.closest(".protected-portals")).toBeInTheDocument();
    expect(tooltip).toBeVisible();
    revisionStatus = 503;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(tooltip).not.toBeVisible();
    revisionStatus = 401;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1001); });
    expect(tooltip).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { hidden: true })).not.toBeInTheDocument();
    expect(router.replace).toHaveBeenCalledWith("/login");
  });

  it("ignores an aborted old service's authorization response", async () => {
    const lifecycle = createBrowserPollingLifecycle();
    const reconcile = vi.fn();
    lifecycle.setReconciliationHandler(reconcile);
    let resolveOld!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(new Promise<Response>(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce(Response.json(observed(200))));
    const view = render(<PollingLifecycleProvider value={lifecycle}><ServiceStatus serviceId="old-service" /></PollingLifecycleProvider>);
    await act(async () => view.rerender(<PollingLifecycleProvider value={lifecycle}><ServiceStatus serviceId="new-service" /></PollingLifecycleProvider>));
    await act(async () => resolveOld(new Response("stale unauthorized response", { status: 401 })));
    expect(screen.getByRole("img")).toHaveAccessibleName(/^Reachable; HTTP 200/);
    expect(reconcile).not.toHaveBeenCalled();
  });
});
