import { StrictMode, useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigurationSnapshotBoundary, ConfigurationSyncProvider, useConfigurationSync } from "@/components/ConfigurationSyncProvider";
import { UnsavedChangesProvider, useUnsavedChanges, useUnsavedSource } from "@/components/unsaved/UnsavedChangesProvider";
import { usePollingLifecycle } from "@/components/PollingLifecycle";
import { startPolling } from "@/lib/clientPolling";
import SettingsPanel from "@/components/SettingsPanel";
import ServiceForm from "@/components/ServiceForm";
import BookmarkGroupForm from "@/components/BookmarkGroupForm";
import SessionRenewal from "@/components/SessionRenewal";
import Kebab from "@/components/edit/Kebab";
import type { KokpitConfig } from "@/config/schema";
import type { AppearanceProps } from "@/config/theme";
import { useWidget } from "@/widgets/useWidget";

const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/SessionManager", () => ({ default: () => null }));
const appearance: AppearanceProps = { theme: "dark", customCss: undefined, bgStyle: {} };
const config: KokpitConfig = { schema_version: 2, appearance: { theme: "dark" }, auth: { enabled: false }, layout: {}, services: [], service_tiles: [] };
let endpoint: () => Promise<Response>;
const revisionResponse = (revision = "one", editable = true) => new Response(JSON.stringify({ revision, editable }));
const fetchMock = vi.fn();
const eligibility = (visible: boolean, online = true) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: visible ? "visible" : "hidden" });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: online });
};
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); eligibility(true);
  endpoint = async () => revisionResponse();
  fetchMock.mockImplementation(async (url: string) => url === "/api/config/revision" ? endpoint()
    : new Response(JSON.stringify(config), { headers: { "x-config-revision": "one" } }));
  vi.stubGlobal("fetch", fetchMock);
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); document.getElementById("kokpit-custom-css")?.remove(); eligibility(true); });
async function tick(milliseconds = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); }); }
function Probe({ dirty = false }: { dirty?: boolean }) {
  const sync = useConfigurationSync()!;
  useUnsavedSource("test", { label: "Test draft", dirty, discard: () => undefined });
  return <><span data-testid="revision">{sync.revision}</span><span data-testid="stale">{String(sync.stale("one"))}</span>
    <button onClick={() => sync.acknowledge("two")}>Acknowledge save</button>
    <button onClick={() => sync.previewTheme("light")}>Preview</button><button onClick={() => sync.previewTheme(null)}>End preview</button></>;
}
function Surface({ revision = "one", dataRevision = "data-one", resolved = appearance, children = <Probe /> }: {
  revision?: string | null; dataRevision?: string; resolved?: AppearanceProps; children?: React.ReactNode;
}) {
  return <UnsavedChangesProvider><ConfigurationSyncProvider initialRevision={revision} initialEditable={true}
    initialAppearance={resolved} initialDataRevision={dataRevision}>{children}</ConfigurationSyncProvider></UnsavedChangesProvider>;
}

function ChildWidget() {
  useWidget("saved-tile", 0, "search");
  return null;
}
function ChildAuthorizationProbe({ onDiscard }: { onDiscard: () => void }) {
  const [value, setValue] = useState("Kept private draft");
  const [child, setChild] = useState(false);
  useUnsavedSource("private-editor", {
    label: "Private editor", dirty: value !== "Saved value", version: value,
    discard: () => { onDiscard(); setValue("Saved value"); },
  });
  return <><input aria-label="Private draft" value={value} onChange={(event) => setValue(event.target.value)} />
    <button onClick={() => setChild(true)}>Start child request</button>{child && <ChildWidget />}</>;
}

describe("authorized configuration observation", () => {
  it("observes unchanged revisions without repeated renders and acknowledges a changed server render once", async () => {
    const view = render(<Surface />); await tick();
    expect(router.refresh).not.toHaveBeenCalled();
    await tick(5_000); expect(router.refresh).not.toHaveBeenCalled();
    endpoint = async () => revisionResponse("two");
    await tick(5_000);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("revision")).toHaveTextContent("two");
    await tick(5_000); expect(router.refresh).toHaveBeenCalledTimes(1);
    view.rerender(<Surface revision="two" resolved={{ theme: "oled", customCss: undefined, bgStyle: { "--card-blur": "8px" } }} />);
    expect(document.documentElement.dataset.theme).toBe("oled");
    expect(document.body.style.getPropertyValue("--card-blur")).toBe("8px");
    await tick(5_000); expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps a cold unavailable recovery observer mounted and renders after authorized repair", async () => {
    endpoint = async () => new Response("{}", { status: 503 });
    const view = render(<Surface revision={null}><p>Repaired content</p></Surface>); await tick();
    expect(screen.getByText("Repaired content")).not.toBeVisible();
    endpoint = async () => revisionResponse("repaired"); await tick(6_001);
    expect(router.refresh).toHaveBeenCalledOnce();
    view.rerender(<Surface revision="repaired"><p>Repaired content</p></Surface>);
    expect(screen.getByText("Repaired content")).toBeVisible();
  });

  it("retains the last authorized mounted editor when a refresh races dirty server props", async () => {
    const view = render(<Surface><input aria-label="Retained editor" defaultValue="initial" /></Surface>); await tick();
    fireEvent.change(screen.getByLabelText("Retained editor"), { target: { value: "newer unsaved value" } });
    view.rerender(<Surface revision={null}>{null}</Surface>);
    expect(screen.getByLabelText("Retained editor")).toHaveValue("newer unsaved value");
    expect(screen.getByLabelText("Retained editor")).not.toBeVisible();
    await tick(1_001);
    expect(router.refresh).toHaveBeenCalledOnce();
    view.rerender(<Surface><input aria-label="Retained editor" defaultValue="initial" /></Surface>);
    expect(screen.getByLabelText("Retained editor")).toBeVisible();
    expect(screen.getByLabelText("Retained editor")).toHaveValue("newer unsaved value");
  });

  it("retains a settings subtree when only its page read becomes unavailable", async () => {
    const view = render(<Surface><ConfigurationSnapshotBoundary revision="one"><input aria-label="Page draft" defaultValue="typed" /></ConfigurationSnapshotBoundary></Surface>); await tick();
    view.rerender(<Surface><ConfigurationSnapshotBoundary revision={null}>{null}</ConfigurationSnapshotBoundary></Surface>);
    expect(screen.getByLabelText("Page draft")).toHaveValue("typed");
    expect(screen.getByLabelText("Page draft")).not.toBeVisible();
  });

  it("keeps a null initial page masked despite an available shell and unchanged successful polls", async () => {
    const view = render(<Surface><ConfigurationSnapshotBoundary revision={null}>{null}</ConfigurationSnapshotBoundary></Surface>);
    await tick();
    expect(document.querySelector(".protected-surface")).not.toBeVisible();
    expect(screen.getByRole("heading", { name: "Checking dashboard access" })).toBeVisible();
    expect(router.refresh).toHaveBeenCalledOnce();
    await tick(5_000);
    expect(document.querySelector(".protected-surface")).not.toBeVisible();
    expect(router.refresh).toHaveBeenCalledOnce();
    view.rerender(<Surface><ConfigurationSnapshotBoundary revision="one"><p>Repaired page</p></ConfigurationSnapshotBoundary></Surface>);
    await tick(1_001);
    expect(screen.getByText("Repaired page")).toBeVisible();
  });

  it.each(["one", "two"])("keeps a newer page masked under an older shell when the poll observes %s", async (observed) => {
    let payloads = 0;
    function Data({ identity }: { identity: string }) {
      const lifecycle = usePollingLifecycle();
      useEffect(() => {
        const polling = startPolling({ interval: 0, lifecycle, attempt: async () => { payloads++; return { kind: "success" }; } });
        return () => polling.dispose();
      }, [identity, lifecycle]);
      return <p>Page payload</p>;
    }
    const content = (pageRevision: string) => <ConfigurationSnapshotBoundary revision={pageRevision}>
      <SettingsPanel config={config} initialRevision={pageRevision} /><Data identity={pageRevision} />
    </ConfigurationSnapshotBoundary>;
    const resolved = { ...appearance, bgStyle: { "--app-bg-color": "#123456" } };
    const view = render(<Surface resolved={resolved}>{content("one")}</Surface>); await tick();
    expect(payloads).toBe(1);
    fireEvent.change(screen.getByLabelText("Custom CSS"), { target: { value: ".kept-draft {}" } });
    endpoint = async () => revisionResponse(observed);
    view.rerender(<Surface resolved={resolved}>{content("two")}</Surface>);
    expect(screen.getByLabelText("Custom CSS")).not.toBeVisible();
    expect(screen.getByLabelText("Custom CSS")).toHaveValue(".kept-draft {}");
    expect(document.body.style.getPropertyValue("--app-bg-color")).toBe("");
    await tick(1_001);
    expect(payloads).toBe(1);
    expect(router.refresh).toHaveBeenCalledOnce();
    await tick(5_000);
    expect(screen.getByLabelText("Custom CSS")).not.toBeVisible();
    expect(payloads).toBe(1);
    expect(router.refresh).toHaveBeenCalledOnce();
    endpoint = async () => revisionResponse("two");
    view.rerender(<Surface revision="two" dataRevision="data-two" resolved={resolved}>{content("two")}</Surface>);
    await tick(1_001);
    expect(screen.getByLabelText("Custom CSS")).toBeVisible();
    expect(screen.getByLabelText("Custom CSS")).toHaveValue(".kept-draft {}");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(payloads).toBe(2);
  });

  it("unregisters a mismatched page under Strict Mode and waits for a fresh access check before revealing its successor", async () => {
    const view = render(<StrictMode><Surface><ConfigurationSnapshotBoundary revision="two"><p>Racing page</p></ConfigurationSnapshotBoundary></Surface></StrictMode>);
    await tick();
    expect(screen.getByText("Racing page")).not.toBeVisible();
    view.rerender(<StrictMode><Surface><ConfigurationSnapshotBoundary revision="one"><p>Next page</p></ConfigurationSnapshotBoundary></Surface></StrictMode>);
    expect(screen.getByText("Next page")).not.toBeVisible();
    await tick(1_001);
    expect(screen.getByText("Next page")).toBeVisible();
  });

  it("retries a dropped server render after its bounded coalescing window", async () => {
    render(<Surface />); await tick(); endpoint = async () => revisionResponse("two");
    await tick(5_000); expect(router.refresh).toHaveBeenCalledTimes(1);
    await tick(5_000); expect(router.refresh).toHaveBeenCalledTimes(1);
    await tick(5_000); expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it("does not classify published own-write bytes as external before the PATCH acknowledgment", async () => {
    function Writer() {
      const [saving, setSaving] = useState(false);
      const [baseline, setBaseline] = useState("one");
      const sync = useConfigurationSync()!;
      useUnsavedSource("writer", { label: "Writer", dirty: true, saving, discard: () => undefined });
      return <><button onClick={() => setSaving(true)}>Start own write</button>
        <button onClick={() => { sync.acknowledge("two"); setBaseline("two"); setSaving(false); }}>Finish own write</button>
        <output data-testid="writer-stale">{String(sync.stale(baseline))}</output></>;
    }
    render(<Surface><Writer /></Surface>); await tick();
    fireEvent.click(screen.getByRole("button", { name: "Start own write" }));
    endpoint = async () => revisionResponse("two"); await tick(5_000);
    expect(screen.queryByText(/Configuration changed. Unsaved drafts/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finish own write" })); await tick(1_001);
    expect(screen.getByTestId("writer-stale")).toHaveTextContent("false");
    expect(screen.queryByText(/Configuration changed. Unsaved drafts/)).not.toBeInTheDocument();
    endpoint = async () => revisionResponse("three"); await tick(5_000);
    expect(screen.getByText(/Configuration changed. Unsaved drafts/)).toBeVisible();
  });

  it("invalidates zero-interval data once for a newer-than-requested rendered config, while cosmetic changes do not refetch", async () => {
    let payloads = 0;
    function Data() {
      const lifecycle = usePollingLifecycle();
      useEffect(() => {
        const polling = startPolling({ interval: 0, lifecycle, attempt: async () => { payloads++; return { kind: "success" }; } });
        return () => polling.dispose();
      }, [lifecycle]);
      return <p>Data</p>;
    }
    const view = render(<Surface><Data /></Surface>); await tick(); expect(payloads).toBe(1);
    endpoint = async () => revisionResponse("two"); await tick(5_000);
    endpoint = async () => revisionResponse("three");
    view.rerender(<Surface revision="three" dataRevision="data-three"><Data /></Surface>); await tick(1_001);
    expect(payloads).toBe(2);
    endpoint = async () => revisionResponse("four"); await tick(5_000);
    view.rerender(<Surface revision="four" dataRevision="data-three"><Data /></Surface>); await tick();
    expect(payloads).toBe(2);
  });

  it("restores authorized background values after masking an active theme preview and clears them on protected teardown", async () => {
    const resolved = { ...appearance, bgStyle: { "--app-bg-color": "#123456", "--app-bg-display": "block" } };
    const view = render(<Surface resolved={resolved} />); await tick();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    eligibility(false); fireEvent(document, new Event("visibilitychange")); await tick();
    expect(document.body.style.getPropertyValue("--app-bg-color")).toBe("");
    eligibility(true); fireEvent(document, new Event("visibilitychange")); await tick(1_001);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.body.style.getPropertyValue("--app-bg-color")).toBe("#123456");
    view.unmount(); expect(document.body.style.getPropertyValue("--app-bg-color")).toBe("");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("keeps one revision request in flight and aborts it on unmount", async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, options: RequestInit) => { signal = options.signal as AbortSignal; return new Promise(() => undefined); });
    const view = render(<Surface />); await tick(6_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    view.unmount(); expect(signal?.aborted).toBe(true);
    await tick(30_000); expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("masks temporary failures, retains mounted drafts, retries, and reveals only the acknowledged authorized render", async () => {
    const view = render(<Surface><input aria-label="Mounted draft" defaultValue="kept" /></Surface>); await tick();
    endpoint = async () => new Response("{}", { status: 503 });
    await tick(5_000);
    expect(screen.getByText("Configuration is temporarily unavailable. Retrying automatically.")).toBeVisible();
    expect(screen.getByLabelText("Mounted draft")).not.toBeVisible();
    expect(screen.getByLabelText("Mounted draft")).toHaveValue("kept");
    endpoint = async () => revisionResponse("two");
    await tick(6_001);
    expect(screen.getByLabelText("Mounted draft")).not.toBeVisible();
    view.rerender(<Surface revision="two"><input aria-label="Mounted draft" defaultValue="kept" /></Surface>);
    expect(screen.getByLabelText("Mounted draft")).toBeVisible();
    expect(screen.getByLabelText("Mounted draft")).toHaveValue("kept");
  });

  it("reauthorizes a hidden/resumed surface before any child data request resumes", async () => {
    let payloads = 0;
    function Data() {
      const lifecycle = usePollingLifecycle();
      useEffect(() => {
        const polling = startPolling({ interval: 1_000, lifecycle, attempt: async () => { payloads++; return { kind: "success" }; } });
        return () => polling.dispose();
      }, [lifecycle]);
      return <p>Protected payload</p>;
    }
    render(<Surface><Data /></Surface>); await tick(); expect(payloads).toBe(1);
    eligibility(false); fireEvent(document, new Event("visibilitychange")); await tick(20_000);
    expect(screen.getByText("Protected payload")).not.toBeVisible(); expect(payloads).toBe(1);
    let finish!: (response: Response) => void;
    endpoint = () => new Promise((resolve) => { finish = resolve; });
    eligibility(true); fireEvent(document, new Event("visibilitychange")); await tick();
    expect(screen.getByText("Protected payload")).not.toBeVisible(); expect(payloads).toBe(1);
    await act(async () => { finish(revisionResponse()); }); await tick();
    expect(screen.getByText("Protected payload")).toBeVisible(); expect(payloads).toBe(2);
  });

  it.each([200, 401, 503])("preserves a visible native editor during focus checks until a stable %s response", async (status) => {
    const close = vi.fn();
    render(<Surface><ServiceForm baselineRevision="one" service={null} existingGroups={[]} onSave={vi.fn()} onClose={close} /></Surface>); await tick();
    const input = screen.getByLabelText("Name *") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Editing service" } });
    input.focus(); input.setSelectionRange(2, 7);
    const dialog = input.closest("dialog")!;
    const beforeChecks = fetchMock.mock.calls.filter(([url]) => url === "/api/config/revision").length;
    const beforeOpens = vi.mocked(HTMLDialogElement.prototype.showModal).mock.calls.length;
    let finish!: (response: Response) => void;
    endpoint = () => new Promise<Response>((resolve) => { finish = resolve; });
    for (let index = 0; index < 20; index++) fireEvent(window, new Event("focus"));
    expect(input).toBeVisible(); expect(dialog).toHaveAttribute("open");
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 7]);
    expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled();
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(beforeOpens);
    await tick(1_001);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/config/revision")).toHaveLength(beforeChecks + 1);
    for (let index = 0; index < 20; index++) fireEvent(window, new Event("focus"));
    await tick();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/config/revision")).toHaveLength(beforeChecks + 1);
    expect(input).toBeVisible(); expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 7]);
    await act(async () => { finish(status === 200 ? revisionResponse() : new Response("{}", { status })); });
    if (status === 200) {
      expect(input).toBeVisible(); expect(dialog).toHaveAttribute("open");
      expect(document.activeElement).toBe(input);
      expect([input.selectionStart, input.selectionEnd]).toEqual([2, 7]);
      expect(HTMLDialogElement.prototype.close).not.toHaveBeenCalled();
      expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(beforeOpens);
      expect(close).not.toHaveBeenCalled();
    } else if (status === 503) {
      expect(input).not.toBeVisible(); expect(dialog).not.toHaveAttribute("open");
      expect(input).toHaveValue("Editing service"); expect(close).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    } else {
      expect(screen.queryByLabelText("Name *")).not.toBeInTheDocument();
      expect(router.replace).toHaveBeenCalledExactlyOnceWith("/login");
    }
  });

  it.each(["hidden", "offline"])("keeps %s recovery masked through arriving RSC props until a fresh check completes", async (pause) => {
    const close = vi.fn();
    const editor = <ServiceForm baselineRevision="one" service={null} existingGroups={[]} onSave={vi.fn()} onClose={close} />;
    const view = render(<Surface>{editor}</Surface>); await tick();
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Kept on resume" } });
    eligibility(pause !== "hidden", pause !== "offline");
    if (pause === "hidden") fireEvent(document, new Event("visibilitychange"));
    else fireEvent(window, new Event("offline"));
    await tick(1_001);
    let finish!: (response: Response) => void;
    endpoint = () => new Promise<Response>((resolve) => { finish = resolve; });
    eligibility(true);
    if (pause === "hidden") fireEvent(document, new Event("visibilitychange"));
    else fireEvent(window, new Event("online"));
    await tick();
    view.rerender(<Surface revision={null}>{null}</Surface>);
    view.rerender(<Surface>{editor}</Surface>);
    expect(screen.getByLabelText("Name *")).not.toBeVisible();
    expect(screen.getByLabelText("Name *").closest("dialog")).not.toHaveAttribute("open");
    expect(screen.getByLabelText("Name *")).toHaveValue("Kept on resume");
    const checks = fetchMock.mock.calls.filter(([url]) => url === "/api/config/revision");
    const pendingSignal = checks.at(-1)?.[1]?.signal as AbortSignal | undefined;
    for (let index = 0; index < 20; index++) fireEvent(window, new Event("focus"));
    await tick();
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/config/revision")).toHaveLength(checks.length);
    expect(pendingSignal?.aborted).toBe(false);
    await act(async () => { finish(revisionResponse()); });
    expect(screen.getByLabelText("Name *")).toBeVisible();
    expect(screen.getByLabelText("Name *")).toHaveValue("Kept on resume");
    expect(screen.getByLabelText("Name *").closest("dialog")).toHaveAttribute("open");
    expect(close).not.toHaveBeenCalled();
  });

  it("clears sensitive draft owners and masks native top-layer dialogs before authorization navigation", async () => {
    const discard = vi.fn();
    function PrivateEditor() {
      useUnsavedSource("secret", { label: "Private input", dirty: true, discard });
      return <dialog open data-testid="native-dialog">Private modal</dialog>;
    }
    render(<Surface><PrivateEditor /></Surface>); await tick();
    endpoint = async () => new Response("{}", { status: 401 }); await tick(5_000);
    expect(discard).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("native-dialog")).not.toBeInTheDocument();
    expect(router.replace).toHaveBeenCalledExactlyOnceWith("/login");
    expect(screen.getByText("Sign-in required")).toBeVisible();
  });

  it("retains a native editor while releasing its modal presentation for neutral retry", async () => {
    const close = vi.fn();
    render(<Surface><ServiceForm baselineRevision="one" service={null} existingGroups={[]} onSave={vi.fn()} onClose={close} /></Surface>); await tick();
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Retained modal value" } });
    endpoint = async () => new Response("{}", { status: 503 }); await tick(5_000);
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.getByLabelText("Name *").closest("dialog")).not.toHaveAttribute("open");
    expect(close).not.toHaveBeenCalled();
    endpoint = async () => revisionResponse();
    fireEvent.click(screen.getByRole("button", { name: "Retry" })); await tick(1_001);
    expect(screen.getByLabelText("Name *")).toHaveValue("Retained modal value");
    expect(screen.getByLabelText("Name *").closest("dialog")).toHaveAttribute("open");
    expect(close).not.toHaveBeenCalled();
  });

  it("gates owned body overlays during temporary failure and removes them on confirmed authorization loss", async () => {
    render(<Surface><Kebab label="Private group options">{() => <input aria-label="Portal group name" defaultValue="Private name" />}</Kebab></Surface>); await tick();
    fireEvent.click(screen.getByRole("button", { name: "Private group options" }));
    const input = screen.getByLabelText("Portal group name");
    expect(input.closest(".protected-portals")).toBeInTheDocument();
    endpoint = async () => new Response("{}", { status: 503 }); await tick(5_000);
    expect(input).not.toBeVisible(); expect(input).toHaveValue("Private name");
    endpoint = async () => new Response("{}", { status: 401 });
    fireEvent.click(screen.getByRole("button", { name: "Retry" })); await tick(1_001);
    expect(screen.queryByLabelText("Portal group name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Private group options" })).not.toBeInTheDocument();
  });

  it("masks and clears immediately when silent renewal confirms that the session has expired", async () => {
    fetchMock.mockImplementation(async (url: string) => url === "/api/auth/session/refresh"
      ? new Response("{}", { status: 401 }) : revisionResponse());
    render(<Surface><SessionRenewal /><p>Authenticated private data</p></Surface>); await tick();
    expect(screen.queryByText("Authenticated private data")).not.toBeInTheDocument();
    expect(router.replace).toHaveBeenCalledExactlyOnceWith("/login");
  });

  it.each([503, 401, 403])("reconciles a recovery GET denial through the stable revision endpoint (%s)", async (status) => {
    const discard = vi.fn();
    function Recover() {
      const unsaved = useUnsavedChanges()!;
      return <button onClick={() => void unsaved.verifyRevision()}>Verify recovered baseline</button>;
    }
    fetchMock.mockImplementation(async (url: string) => url === "/api/settings" ? new Response("{}", { status: 401 }) : endpoint());
    render(<Surface><Recover /><ChildAuthorizationProbe onDiscard={discard} /></Surface>); await tick();
    const before = fetchMock.mock.calls.filter(([url]) => url === "/api/config/revision").length;
    endpoint = async () => new Response("{}", { status });
    fireEvent.click(screen.getByRole("button", { name: "Verify recovered baseline" })); await tick();
    expect(screen.getByLabelText("Private draft")).not.toBeVisible();
    expect(discard).not.toHaveBeenCalled(); expect(router.replace).not.toHaveBeenCalled();
    await tick(1_001);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/config/revision")).toHaveLength(before + 1);
    if (status === 503) {
      expect(screen.getByLabelText("Private draft")).toHaveValue("Kept private draft");
      expect(screen.getByLabelText("Private draft")).not.toBeVisible();
      expect(discard).not.toHaveBeenCalled(); expect(router.replace).not.toHaveBeenCalled();
      endpoint = async () => revisionResponse();
      fireEvent.click(screen.getByRole("button", { name: "Retry" })); await tick(1_001);
      expect(screen.getByLabelText("Private draft")).toBeVisible();
      expect(screen.getByLabelText("Private draft")).toHaveValue("Kept private draft");
    } else {
      expect(screen.queryByLabelText("Private draft")).not.toBeInTheDocument();
      expect(discard).toHaveBeenCalledOnce();
      expect(router.replace).toHaveBeenCalledExactlyOnceWith("/login");
    }
  });

  it.each([false, true])("rechecks a child 401 without discarding drafts through unavailable config (old GET in flight: %s)", async (inFlight) => {
    const discard = vi.fn();
    let widgets = 0;
    fetchMock.mockImplementation(async (url: string) => url === "/api/config/revision" ? endpoint()
      : url.startsWith("/api/widget?") && ++widgets === 1 ? new Response("{}", { status: 401 })
        : new Response(JSON.stringify({ ok: true, data: {} })));
    render(<Surface><ChildAuthorizationProbe onDiscard={discard} /></Surface>); await tick();
    let finishOld!: (response: Response) => void;
    if (inFlight) {
      endpoint = () => new Promise<Response>((resolve) => { finishOld = resolve; });
      await tick(5_000);
    }
    const oldSignal = fetchMock.mock.calls.filter(([url]) => url === "/api/config/revision").at(-1)?.[1]?.signal as AbortSignal | undefined;
    fireEvent.click(screen.getByRole("button", { name: "Start child request" })); await tick();
    expect(screen.getByLabelText("Private draft")).not.toBeVisible();
    expect(screen.getByLabelText("Private draft")).toHaveValue("Kept private draft");
    expect(discard).not.toHaveBeenCalled(); expect(router.replace).not.toHaveBeenCalled();
    if (inFlight) {
      expect(oldSignal?.aborted).toBe(true);
      await act(async () => { finishOld(revisionResponse()); });
      expect(screen.getByLabelText("Private draft")).not.toBeVisible();
    }
    endpoint = async () => new Response("{}", { status: 503 }); await tick(1_001);
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(screen.getByLabelText("Private draft")).not.toBeVisible();
    expect(discard).not.toHaveBeenCalled(); expect(router.replace).not.toHaveBeenCalled();
    endpoint = async () => revisionResponse();
    fireEvent.click(screen.getByRole("button", { name: "Retry" })); await tick(1_001);
    expect(screen.getByLabelText("Private draft")).toBeVisible();
    expect(screen.getByLabelText("Private draft")).toHaveValue("Kept private draft");
    expect(discard).not.toHaveBeenCalled(); expect(router.replace).not.toHaveBeenCalled();
  });

  it.each([401, 403])("clears drafts only after a fresh revision check confirms %s following a child 401", async (status) => {
    const discard = vi.fn();
    fetchMock.mockImplementation(async (url: string) => url === "/api/config/revision" ? endpoint() : new Response("{}", { status: 401 }));
    render(<Surface><ChildAuthorizationProbe onDiscard={discard} /></Surface>); await tick();
    const before = fetchMock.mock.calls.filter(([url]) => url === "/api/config/revision").length;
    endpoint = async () => new Response("{}", { status });
    fireEvent.click(screen.getByRole("button", { name: "Start child request" })); await tick(1_001);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/config/revision")).toHaveLength(before + 1);
    expect(discard).toHaveBeenCalledOnce();
    expect(router.replace).toHaveBeenCalledExactlyOnceWith("/login");
    expect(screen.queryByLabelText("Private draft")).not.toBeInTheDocument();
  });

  it.each([200, 401, 503])("keeps a null-to-valid shell refresh masked until its pending access recheck confirms %s", async (status) => {
    const discard = vi.fn();
    let widgets = 0;
    fetchMock.mockImplementation(async (url: string) => url === "/api/config/revision" ? endpoint()
      : url.startsWith("/api/widget?") && ++widgets === 1 ? new Response("{}", { status: 401 })
        : new Response(JSON.stringify({ ok: true, data: {} })));
    const editor = <ChildAuthorizationProbe onDiscard={discard} />;
    const view = render(<Surface>{editor}</Surface>); await tick();
    let finishCheck!: (response: Response) => void;
    endpoint = () => new Promise<Response>((resolve) => { finishCheck = resolve; });
    fireEvent.click(screen.getByRole("button", { name: "Start child request" })); await tick(1_001);
    expect(screen.getByLabelText("Private draft")).not.toBeVisible();
    view.rerender(<Surface revision={null}>{null}</Surface>);
    view.rerender(<Surface>{editor}</Surface>);
    expect(screen.getByLabelText("Private draft")).not.toBeVisible();
    expect(screen.getByLabelText("Private draft")).toHaveValue("Kept private draft");
    expect(discard).not.toHaveBeenCalled(); expect(router.replace).not.toHaveBeenCalled();
    await act(async () => { finishCheck(status === 200 ? revisionResponse() : new Response("{}", { status })); });
    if (status === 200) {
      expect(screen.getByLabelText("Private draft")).toBeVisible();
      expect(screen.getByLabelText("Private draft")).toHaveValue("Kept private draft");
      expect(discard).not.toHaveBeenCalled(); expect(router.replace).not.toHaveBeenCalled();
    } else if (status === 401) {
      expect(screen.queryByLabelText("Private draft")).not.toBeInTheDocument();
      expect(discard).toHaveBeenCalledOnce();
      expect(router.replace).toHaveBeenCalledExactlyOnceWith("/login");
    } else {
      expect(screen.getByLabelText("Private draft")).not.toBeVisible();
      view.rerender(<Surface revision={null}>{null}</Surface>);
      view.rerender(<Surface>{editor}</Surface>);
      expect(screen.getByLabelText("Private draft")).not.toBeVisible();
      expect(discard).not.toHaveBeenCalled(); expect(router.replace).not.toHaveBeenCalled();
      endpoint = async () => revisionResponse();
      fireEvent.click(screen.getByRole("button", { name: "Retry" })); await tick(1_001);
      expect(screen.getByLabelText("Private draft")).toBeVisible();
      expect(screen.getByLabelText("Private draft")).toHaveValue("Kept private draft");
    }
  });

  it("does not roll back an own-save acknowledgment with an older in-flight GET, and still detects a newer write", async () => {
    render(<Surface />); await tick();
    let finish!: (response: Response) => void;
    endpoint = () => new Promise((resolve) => { finish = resolve; }); await tick(5_000);
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge save" }));
    await act(async () => { finish(revisionResponse("one")); });
    expect(screen.getByTestId("revision")).toHaveTextContent("two");
    endpoint = async () => revisionResponse("three"); await tick(1_001);
    expect(screen.getByTestId("revision")).toHaveTextContent("three");
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("keeps an active appearance preview until it is explicitly released", async () => {
    const view = render(<Surface />); await tick();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    endpoint = async () => revisionResponse("two"); await tick(5_000);
    view.rerender(<Surface revision="two" resolved={{ theme: "oled", customCss: undefined, bgStyle: {} }} />);
    expect(document.documentElement.dataset.theme).toBe("light");
    fireEvent.click(screen.getByRole("button", { name: "End preview" }));
    expect(document.documentElement.dataset.theme).toBe("oled");
  });

  it("blocks writes on stable migration-required snapshots while keeping authorized reads visible", async () => {
    endpoint = async () => revisionResponse("one", false);
    render(<Surface><ServiceForm baselineRevision="one" service={null} existingGroups={[]} onSave={vi.fn()} onClose={vi.fn()} /></Surface>); await tick();
    expect(screen.getByText(/requires migration before it can be edited/)).toBeVisible();
    expect(screen.getByLabelText("Name *")).toBeDisabled();
  });
});

describe("server refreshes and editor baselines", () => {
  it.each([
    { name: "accepts its own rendered revision", renderedRevision: "three", status: 200, conflicted: false },
    { name: "preserves a newer external revision after success", renderedRevision: "external-four", status: 200, conflicted: true },
    { name: "preserves a revision mismatch rejection", renderedRevision: "external-four", status: 409, conflicted: true },
    { name: "preserves an external change after a failed write", renderedRevision: "external-four", status: 503, conflicted: true },
    { name: "keeps a failed write retryable when the render matches its prior accepted baseline", renderedRevision: "two", status: 503, conflicted: false },
  ])("$name when a prior save refresh lands during the next write", async ({ renderedRevision, status, conflicted }) => {
    const afterFirst: KokpitConfig = { ...config, appearance: { theme: "dark", custom_css: ".own {}" } };
    const afterSecond: KokpitConfig = { ...afterFirst, groups: [{ name: "Own group" }] };
    const external: KokpitConfig = { ...config, appearance: { theme: "oled", custom_css: ".external {}" }, groups: [{ name: "External group" }] };
    let finishSecond!: (response: Response) => void;
    let patches = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/config/revision") return endpoint();
      if (init?.method === "PATCH") {
        patches++;
        if (patches === 1) return new Response(JSON.stringify(afterFirst), { headers: { "x-config-revision": "two" } });
        return new Promise<Response>((resolve) => { finishSecond = resolve; });
      }
      return new Response(JSON.stringify(config), { headers: { "x-config-revision": "one" } });
    });
    const view = render(<Surface><SettingsPanel config={config} initialRevision="one" /></Surface>); await tick();
    fireEvent.change(screen.getByLabelText("Custom CSS"), { target: { value: ".own {}" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" })); await tick();
    expect(patches).toBe(1); expect(router.refresh).toHaveBeenCalledOnce();
    // This sibling draft must survive both a confirmed own render and a
    // genuine external conflict; neither result may silently replace it.
    fireEvent.change(screen.getByLabelText("Custom CSS"), { target: { value: ".later {}" } });
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    fireEvent.change(screen.getByLabelText("New group name"), { target: { value: "Own group" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add group" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" })); await tick();
    expect(patches).toBe(2);
    const rendered = renderedRevision === "three" ? afterSecond : renderedRevision === "two" ? afterFirst : external;
    endpoint = async () => revisionResponse(renderedRevision);
    view.rerender(<Surface revision={renderedRevision}><SettingsPanel config={rendered} initialRevision={renderedRevision} /></Surface>);
    await tick(1001);
    const response = status === 200
      ? new Response(JSON.stringify(afterSecond), { headers: { "x-config-revision": "three" } })
      : new Response(JSON.stringify({ code: status === 409 ? "revision_mismatch" : "config_unavailable" }), { status });
    await act(async () => { finishSecond(response); });
    await tick(5000);
    const conflict = screen.queryByText(/settings.yaml changed on disk. Reload to discard/);
    if (conflicted) {
      expect(conflict).toBeVisible();
      expect(screen.getByRole("button", { name: /^(Save|Error — Retry)$/ })).toBeDisabled();
    } else {
      expect(conflict).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^(Save|Error — Retry)$/ })).toBeEnabled();
    }
    expect(screen.getByLabelText("Group name for Own group")).toHaveValue("Own group");
    expect(screen.queryByLabelText("Group name for External group")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(screen.getByLabelText("Custom CSS")).toHaveValue(".later {}");
    expect(patches).toBe(2);
  });

  it("adopts a refreshed clean settings panel, including removal of old CSS/background values", async () => {
    const view = render(<Surface><SettingsPanel config={config} initialRevision="one" /></Surface>); await tick();
    endpoint = async () => revisionResponse("two"); await tick(5_000);
    const next: KokpitConfig = { ...config, appearance: { theme: "oled", custom_css: ".new {}" } };
    view.rerender(<Surface revision="two"><SettingsPanel config={next} initialRevision="two" /></Surface>);
    expect(screen.getByLabelText("Custom CSS")).toHaveValue(".new {}");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.queryByText("Unsaved settings changes.")).not.toBeInTheDocument();
  });

  it("preserves dirty settings and blocks their old baseline when a comment-only revision arrives", async () => {
    const view = render(<Surface><SettingsPanel config={config} initialRevision="one" /></Surface>); await tick();
    fireEvent.change(screen.getByLabelText("Custom CSS"), { target: { value: ".draft {}" } });
    endpoint = async () => revisionResponse("comment-two"); await tick(5_000);
    view.rerender(<Surface revision="comment-two"><SettingsPanel config={config} initialRevision="comment-two" /></Surface>);
    expect(screen.getByLabelText("Custom CSS")).toHaveValue(".draft {}");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(/Configuration changed. Unsaved drafts/)).toBeVisible();
  });

  it("deliberate discard restores the latest authorized settings and clears the stale baseline", async () => {
    function Leave() {
      const unsaved = useUnsavedChanges()!;
      return <button onClick={() => void unsaved.confirm()}>Discard staged settings</button>;
    }
    const children = (value: KokpitConfig, revision: string) => <><Leave /><SettingsPanel config={value} initialRevision={revision} /></>;
    const view = render(<Surface>{children(config, "one")}</Surface>); await tick();
    fireEvent.change(screen.getByLabelText("Custom CSS"), { target: { value: ".typed-draft {}" } });
    endpoint = async () => revisionResponse("two"); await tick(5_000);
    const latest: KokpitConfig = { ...config, appearance: { theme: "oled", custom_css: ".external-authorized {}" } };
    view.rerender(<Surface revision="two">{children(latest, "two")}</Surface>);
    fireEvent.click(screen.getByRole("button", { name: "Discard staged settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard and continue" })); await tick();
    expect(screen.getByLabelText("Custom CSS")).toHaveValue(".external-authorized {}");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.queryByText("Unsaved settings changes.")).not.toBeInTheDocument();
  });

  it.each(["service", "bookmark"])("preserves an unsubmitted %s form when its otherwise-clean parent refreshes", async (kind) => {
    const save = vi.fn();
    const form = kind === "service"
      ? <ServiceForm baselineRevision="one" service={null} existingGroups={[]} onSave={save} onClose={vi.fn()} />
      : <BookmarkGroupForm baselineRevision="one" bookmark={null} knownGroups={[]} onSave={save} onClose={vi.fn()} />;
    const view = render(<Surface>{form}</Surface>); await tick();
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Typed name" } });
    endpoint = async () => revisionResponse("two"); await tick(5_000);
    view.rerender(<Surface revision="two">{form}</Surface>);
    expect(screen.getByLabelText("Name *")).toHaveValue("Typed name");
    fireEvent.submit(screen.getByLabelText("Name *").closest("form")!);
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText(/Close and reopen this form after reloading/)).toBeVisible();
  });
});
