import { useLayoutEffect, useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  sanitizeRecovery, UnsavedChangesProvider, useDraftRecovery, useUnsavedChanges, useUnsavedSource,
} from "@/components/unsaved/UnsavedChangesProvider";
import GuardedLink from "@/components/unsaved/GuardedLink";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), native: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("next/link", () => ({ default: ({ onNavigate, children, ...props }: {
  onNavigate?: (event: { preventDefault: () => void }) => void; children: React.ReactNode;
  href: string; target?: string; download?: boolean;
}) => <a {...props} onClick={(event) => {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey || props.target === "_blank" || props.download) { navigation.native(); return; }
  let prevented = false;
  onNavigate?.({ preventDefault: () => { prevented = true; } });
  if (!prevented) navigation.native();
}}>{children}</a> }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "x-config-revision": "one" } })));
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); });
});
afterEach(() => vi.unstubAllGlobals());

function Editor({ save = async () => true, survivesNavigation = false, href = "/next" }: {
  save?: (value: string) => Promise<boolean>; survivesNavigation?: boolean; href?: string;
}) {
  const [value, setValue] = useState("original");
  const [baseline, setBaseline] = useState("original");
  const [saving, setSaving] = useState(false);
  const unsaved = useUnsavedChanges()!;
  async function saveValue() {
    const submitted = value;
    setSaving(true);
    try { const ok = await save(submitted); if (ok) setBaseline(submitted); return ok; }
    finally { setSaving(false); }
  }
  useUnsavedSource("editor", { label: "Test editor", dirty: value !== baseline, saving, version: value,
    survivesNavigation, discard: () => setValue(baseline), save: saveValue });
  return <>
    <input aria-label="Draft" value={value} onChange={(event) => setValue(event.target.value)} />
    <button onClick={() => void saveValue()}>Save directly</button>
    <button onClick={() => void unsaved.confirm().then((allowed) => { if (allowed) navigation.push("/exit"); })}>Leave all</button>
    <GuardedLink href={href}>Navigate</GuardedLink>
    <GuardedLink href="/next" target="_blank">New tab</GuardedLink>
    <GuardedLink href="/next" download>Download</GuardedLink>
    <span data-testid="dirty">{String(unsaved.dirty)}</span>
  </>;
}

function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("unsaved navigation registry", () => {
  it("warns only for normalized unsaved work and removes native protection after a revert", () => {
    const view = render(<UnsavedChangesProvider><Editor /></UnsavedChangesProvider>);
    expect(unload()).toBe(false);
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "changed" } });
    expect(unload()).toBe(true);
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "original" } });
    expect(unload()).toBe(false);
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "changed" } });
    view.unmount();
    expect(unload()).toBe(false);
  });

  it("Stay restores focus and draft values; Discard navigates once without a second unload prompt", async () => {
    render(<UnsavedChangesProvider><Editor /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "changed" } });
    screen.getByRole("link", { name: "Navigate" }).focus();
    fireEvent.click(screen.getByRole("link", { name: "Navigate" }));
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Stay" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.getByRole("link", { name: "Navigate" })).toHaveFocus();
    expect(screen.getByLabelText("Draft")).toHaveValue("changed");
    expect(navigation.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "Navigate" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard and continue" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/next", { scroll: undefined }));
    expect(screen.getByLabelText("Draft")).toHaveValue("original");
    expect(unload()).toBe(false);
  });

  it("waits for a valid save before navigation and stays after failed save", async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<UnsavedChangesProvider><Editor save={save} /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("link", { name: "Navigate" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & continue" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Draft")).toHaveValue("changed");
    fireEvent.click(screen.getByRole("link", { name: "Navigate" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & continue" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledOnce());
    expect(save).toHaveBeenLastCalledWith("changed");
    expect(unload()).toBe(false);
  });

  it("keeps work edited during an in-flight save dirty and blocks leaving while the write is pending", async () => {
    let finish!: (value: boolean) => void;
    render(<UnsavedChangesProvider><Editor save={() => new Promise((resolve) => { finish = resolve; })} /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "submitted" } });
    fireEvent.click(screen.getByRole("button", { name: "Save directly" }));
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "newer edit" } });
    fireEvent.click(screen.getByRole("link", { name: "Navigate" }));
    expect(screen.getByRole("button", { name: "Discard and continue" })).toBeDisabled();
    await act(async () => { finish(true); });
    expect(screen.getByLabelText("Draft")).toHaveValue("newer edit");
    expect(unload()).toBe(true);
    expect(navigation.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
  });

  it("does not warn for navigation that retains a dashboard draft or new-tab/download actions", async () => {
    render(<UnsavedChangesProvider><Editor survivesNavigation href="/settings" /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("link", { name: "Navigate" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledExactlyOnceWith("/settings", { scroll: undefined }));
    fireEvent.click(screen.getByRole("link", { name: "New tab" }));
    fireEvent.click(screen.getByRole("link", { name: "Download" }));
    expect(navigation.native).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Draft")).toHaveValue("changed");
    expect(unload()).toBe(true);
  });

  it.each(["older", null])("requires separate review for settings drafts based on different revisions: %s", (revision) => {
    const save = vi.fn(async () => true);
    function Owners() {
      const unsaved = useUnsavedChanges()!;
      useUnsavedSource("first", { label: "First section", scope: "settings", writeRevision: "current", dirty: true, discard: vi.fn(), save });
      useUnsavedSource("second", { label: "Second section", scope: "settings", writeRevision: revision, dirty: true, discard: vi.fn(), save });
      return <button onClick={() => void unsaved.confirm()}>Leave revisions</button>;
    }
    render(<UnsavedChangesProvider><Owners /></UnsavedChangesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Leave revisions" }));
    expect(screen.queryByRole("button", { name: "Save & continue" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("Stay and save each editor separately");
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(save).not.toHaveBeenCalled();
    expect(unload()).toBe(true);
  });

  it("rechecks write ownership after a form transfers its values before any next write", async () => {
    const write = vi.fn(async () => true);
    function Transfer() {
      const [transferred, setTransferred] = useState(false);
      const unsaved = useUnsavedChanges()!;
      useUnsavedSource("form", { label: "Child form", scope: "settings", dirty: !transferred, priority: 0,
        discard: () => undefined, save: async () => { setTransferred(true); return true; } });
      useUnsavedSource("settings", { label: "Settings draft", scope: "settings", writeRevision: "one", dirty: transferred, discard: () => undefined, save: write });
      useUnsavedSource("dashboard", { label: "Dashboard draft", scope: "dashboard", writeRevision: "one", dirty: transferred, discard: () => undefined, save: write });
      return <><button onClick={() => void unsaved.confirm().then((allowed) => { if (allowed) navigation.push("/exit"); })}>Leave transfer</button>
        <span>{transferred ? "Both drafts retained" : "Form retained"}</span></>;
    }
    render(<UnsavedChangesProvider><Transfer /></UnsavedChangesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Leave transfer" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & continue" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Both drafts retained")).toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(unload()).toBe(true);
  });

  it("cancels a stale confirmation after browser traversal without redirecting the new route", async () => {
    render(<UnsavedChangesProvider><Editor /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("link", { name: "Navigate" }));
    fireEvent(window, new PopStateEvent("popstate"));
    await act(async () => {});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Draft")).toHaveValue("changed");
  });

  it("does not let a late rejected save cancel a newer navigation confirmation", async () => {
    let reject!: (error: Error) => void;
    render(<UnsavedChangesProvider><Editor save={() => new Promise((_, fail) => { reject = fail; })} /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("link", { name: "Navigate" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & continue" }));
    fireEvent(window, new PopStateEvent("popstate"));
    fireEvent.click(screen.getByRole("link", { name: "Navigate" }));
    await act(async () => { reject(new Error("old save failed")); });
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
    expect(screen.getByLabelText("Draft")).toHaveValue("changed");
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("tracks a pending editor write after its owner unmounts", async () => {
    let finish!: () => void;
    function Routes() {
      const [show, setShow] = useState(true);
      const context = useUnsavedChanges()!;
      return <><button onClick={() => setShow(false)}>History traversal</button>
        {show && <button onClick={() => { finish = context.beginWrite(); }}>Begin write</button>}</>;
    }
    render(<UnsavedChangesProvider><Routes /></UnsavedChangesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Begin write" }));
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    expect(unload()).toBe(true);
    act(() => finish());
    expect(unload()).toBe(false);
  });
});

function RecoverableEditor({ revision }: { revision: string }) {
  const [text, setText] = useState("");
  const recovery = useDraftRecovery("editor", revision,
    { text, password: "must-not-retain", api_key: "synthetic-key", integrationConfig: { auth: "no" }, url: "https://user:pass@example.com/path?token=synthetic#secret" }, Boolean(text),
    (saved, changed) => { setText(saved.text); if (changed) navigation.native("conflict"); });
  const context = useUnsavedChanges()!;
  useUnsavedSource("editor", { label: "Recovery editor", dirty: Boolean(text), version: text, discard: () => { setText(""); recovery.dismiss(); } });
  return <><input aria-label="Recoverable draft" value={text} onChange={(event) => setText(event.target.value)} />
    {recovery.recovered && <p role="status">Recovered draft</p>}
    <output data-testid="recovery">{JSON.stringify(context.readRecovery("editor"))}</output></>;
}

function RecoveryRoutes() {
  const [show, setShow] = useState(true);
  const [revision, setRevision] = useState("one");
  const context = useUnsavedChanges()!;
  return <><button onClick={() => setShow(!show)}>History traversal</button>
    <button onClick={() => setRevision("two")}>External change</button>
    <button onClick={context.clear}>Clear session</button>
    {show && <RecoverableEditor revision={revision} />}</>;
}

describe("protected-layout memory recovery", () => {
  it("retains non-secret drafts across same-document traversal with revision conflict detection", () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    render(<UnsavedChangesProvider><RecoveryRoutes /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Recoverable draft"), { target: { value: "keep this" } });
    const retained = screen.getByTestId("recovery").textContent!;
    expect(retained).toContain("keep this");
    expect(retained).not.toMatch(/must-not-retain|synthetic-key|synthetic#secret|user:pass|integrationConfig/);
    expect(retained).toContain("https://example.com/path");
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    expect(unload()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "External change" }));
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    expect(screen.getByLabelText("Recoverable draft")).toHaveValue("keep this");
    expect(screen.getByText("Recovered draft")).toBeInTheDocument();
    expect(navigation.native).toHaveBeenCalledWith("conflict");
    expect(local).not.toHaveBeenCalled();
    local.mockRestore();
  });

  it("clears retained work on session loss and protected-layout teardown", () => {
    const view = render(<UnsavedChangesProvider><RecoveryRoutes /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Recoverable draft"), { target: { value: "discard this" } });
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear session" }));
    expect(unload()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    expect(screen.getByLabelText("Recoverable draft")).toHaveValue("");
    view.unmount();
    expect(unload()).toBe(false);
  });

  it("clears only the requested recovery scope without discarding live sources", () => {
    const discard = vi.fn();
    const ids = ["dashboard", "dashboard-dialog", "dashboard:service-form:new", "settings", "settings:bookmark-form:new"];
    function Entries() {
      const context = useUnsavedChanges()!;
      useUnsavedSource("live-editor", { label: "Live editor", dirty: true, discard });
      return <><button onClick={() => ids.forEach((id) => context.writeRecovery(id, { revision: "one", value: id }))}>Retain drafts</button>
        <button onClick={() => context.removeRecoveryScope("dashboard")}>Clear dashboard recovery</button>
        <button onClick={() => context.removeRecoveryScope("settings")}>Clear settings recovery</button>
        <output data-testid="retained-ids">{ids.filter((id) => context.readRecovery(id)).join(",")}</output></>;
    }
    render(<UnsavedChangesProvider><Entries /></UnsavedChangesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Retain drafts" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear dashboard recovery" }));
    expect(screen.getByTestId("retained-ids")).toHaveTextContent("settings,settings:bookmark-form:new");
    expect(screen.getByTestId("retained-ids")).not.toHaveTextContent("dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Clear settings recovery" }));
    expect(screen.getByTestId("retained-ids")).toBeEmptyDOMElement();
    expect(discard).not.toHaveBeenCalled();
    expect(unload()).toBe(true);
  });

  it("removes credential fields and raw connection configs from recovery projections", () => {
    expect(sanitizeRecovery({ name: "kept", nested: { password: "no", authToken: "no", apiKey: "no", safe: "yes" }, widgetConfig: { unknown: "no" } }))
      .toEqual({ name: "kept", nested: { safe: "yes" } });
  });

  it.each(["Note: buy milk", "Note: buy milk?tomorrow", "/plain text", "/plain text?later"])(
    "preserves ordinary projected text verbatim: %s", (text) => {
      expect(sanitizeRecovery({ name: text, description: text })).toEqual({ name: text, description: text });
    }
  );

  it("sanitizes relative URL fields and explicit URLs without rewriting ordinary labels", () => {
    expect(sanitizeRecovery({ name: "Note: buy milk", url: "/path?token=fixture#private", icon: "/icon?key=fixture", bgImage: "/background?token=fixture" }))
      .toEqual({ name: "Note: buy milk", url: "/path", icon: "/icon", bgImage: "/background" });
    expect(sanitizeRecovery("https://user:pass@example.com/path?token=fixture#private")).toBe("https://example.com/path");
  });

  it.each([
    "  https://user:pass@example.com/path?token=fixture#private  ",
    "\u0000ht\ttps://user:pass@example.com/path?token=fixture#private\u0000",
    "ftp://user:pass@example.com/path?token=fixture#private",
    "https:user:fixture@example.com/path?token=fixture#private",
    "https:\\user:fixture@example.com/path?token=fixture#private",
    "//user:pass@example.com/path?token=fixture#private",
    "/path?api_key=fixture#private",
    "example.com/path?api_key=fixture#private",
    "example.com:8080/path?api_key=fixture#private",
    "user:pass@example.com/path?api_key=fixture#private",
    "path/to/page?api_key=fixture#private",
    "example?api_key=fixture#private",
    "#private",
  ])("does not retain normalized URL credentials or query values: %s", (url) => {
    expect(JSON.stringify(sanitizeRecovery({ url }))).not.toMatch(/user|pass|fixture|private/);
  });

  it("keeps schemeless URL paths while excluding query/fragment values only in URL fields", () => {
    const text = "example.com/path?note=fixture#private";
    expect(sanitizeRecovery({ description: text, url: text, launch_url: text, icon: text, bgImage: text }))
      .toEqual({ description: text, url: "example.com/path", launch_url: "example.com/path", icon: "example.com/path", bgImage: "example.com/path" });
  });

  it.each([
    String.raw`\\user:private@example.com/path?token=value#fragment`,
    String.raw`/\user:private@example.com/path?token=value#fragment`,
    String.raw`\/user:private@example.com/path?token=value#fragment`,
  ])("sanitizes browser backslash authorities in URL fields and preserves prose: %s", (text) => {
    expect(new URL(text, "https://recovery.invalid").username).toBe("user");
    expect(sanitizeRecovery({ description: text, url: text })).toEqual({ description: text, url: "//example.com/path" });
  });

  it("omits CSS with URL/import/escape syntax while retaining plain non-secret CSS", () => {
    expect(sanitizeRecovery({
      customCss: '.tile{background:url("https://user:pass@example.com/bg?token=fixture")}',
      bgGradient: '@import "//example.com?api_key=fixture"',
      custom_css: '.tile { background: u\\72l("https://example.com?token=fixture") }',
      name: "kept",
    })).toEqual({ name: "kept" });
    expect(sanitizeRecovery({ customCss: ".tile { color: red; }" })).toEqual({ customCss: ".tile { color: red; }" });
  });

  it("does not let a late save from an unmounted owner clear or rebase its replacement", () => {
    let lateCleanup!: () => void;
    function Owner() {
      const [value, setValue] = useState("");
      const recovery = useDraftRecovery("same-editor", "one", value, Boolean(value), (saved) => setValue(saved));
      return <><input aria-label="Owned draft" value={value} onChange={(event) => setValue(event.target.value)} />
        <button onClick={() => { lateCleanup = () => { recovery.acknowledgeRevision("old-owner-save"); recovery.dismiss(); }; }}>Capture old owner</button></>;
    }
    function Routes() {
      const [show, setShow] = useState(true);
      const context = useUnsavedChanges()!;
      return <><button onClick={() => setShow(!show)}>History traversal</button>
        <button onClick={() => lateCleanup()}>Late completion</button>
        {show && <Owner />}<output data-testid="owned-snapshot">{JSON.stringify(context.readRecovery("same-editor"))}</output></>;
    }
    render(<UnsavedChangesProvider><Routes /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Owned draft"), { target: { value: "old draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Capture old owner" }));
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    fireEvent.change(screen.getByLabelText("Owned draft"), { target: { value: "new draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Late completion" }));
    expect(screen.getByTestId("owned-snapshot")).toHaveTextContent("new draft");
    expect(screen.getByTestId("owned-snapshot")).not.toHaveTextContent("old-owner-save");
  });

  it.each([
    { mountDuringWrite: false, transition: "compatible", synchronous: false },
    { mountDuringWrite: true, transition: "compatible", synchronous: false },
    { mountDuringWrite: false, transition: "incompatible", synchronous: false },
    { mountDuringWrite: false, transition: "external", synchronous: false },
    { mountDuringWrite: false, transition: "external", synchronous: true },
  ])("rechecks a mounted child's baseline after $transition writes (mounted during write: $mountDuringWrite, synchronous: $synchronous)", async ({ mountDuringWrite, transition, synchronous }) => {
    let serverRevision = "one";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "x-config-revision": serverRevision } })));
    function Child({ revision }: { revision: string }) {
      const [value, setValue] = useState("");
      const recovery = useDraftRecovery("settings:service-form:new", revision, value, Boolean(value), (saved) => setValue(saved));
      return <><input aria-label="Recovered child" value={value} onChange={(event) => setValue(event.target.value)} />
        <output data-testid="child-state">{recovery.validating ? "validating" : recovery.conflict ? "conflict" : "ready"}</output></>;
    }
    function Owner() {
      const [revision, setRevision] = useState("one");
      const [showChild, setShowChild] = useState(false);
      const context = useUnsavedChanges()!;
      const recovery = useDraftRecovery("settings", revision, "clean parent", false, () => undefined);
      const finishWrite = useRef<(() => void) | null>(null);
      return <>
        <button onClick={() => {
          context.writeRecovery("settings:service-form:new", { revision: "one", value: "Recovered child" });
          context.writeRecovery("settings:bookmark-form:old", { revision: "older", value: "Older child" });
          context.writeRecovery("settings:group-entry", { revision: "one", value: "Conflicted child", conflicted: true });
          context.writeRecovery("dashboard:service-form:new", { revision: "one", value: "Other writer" });
          setShowChild(true);
        }}>Mount child</button>
        <button onClick={() => { finishWrite.current = context.beginWrite(); }}>Start sibling write</button>
        <button onClick={() => {
          if (synchronous) finishWrite.current = context.beginWrite();
          serverRevision = transition === "external" ? "three" : "two";
          recovery.acknowledgeRevision("two", transition === "incompatible" ? undefined : "one");
          setRevision("two"); finishWrite.current?.();
        }}>Accept sibling write</button>
        {showChild && <Child revision={revision} />}
        <output data-testid="child-snapshots">{JSON.stringify([
          context.readRecovery("settings:service-form:new"), context.readRecovery("settings:bookmark-form:old"),
          context.readRecovery("settings:group-entry"), context.readRecovery("dashboard:service-form:new"),
        ])}</output>
      </>;
    }
    render(<UnsavedChangesProvider><Owner /></UnsavedChangesProvider>);
    if (mountDuringWrite) fireEvent.click(screen.getByRole("button", { name: "Start sibling write" }));
    fireEvent.click(screen.getByRole("button", { name: "Mount child" }));
    if (!mountDuringWrite) {
      await waitFor(() => expect(screen.getByTestId("child-state")).toHaveTextContent("ready"));
      if (!synchronous) fireEvent.click(screen.getByRole("button", { name: "Start sibling write" }));
    }
    if (!synchronous) expect(screen.getByTestId("child-state")).toHaveTextContent("validating");
    fireEvent.click(screen.getByRole("button", { name: "Accept sibling write" }));
    await waitFor(() => expect(screen.getByTestId("child-state")).toHaveTextContent(transition === "compatible" ? "ready" : "conflict"));
    fireEvent.change(screen.getByLabelText("Recovered child"), { target: { value: "Edited after acknowledgement" } });
    const snapshots = JSON.parse(screen.getByTestId("child-snapshots").textContent!);
    expect(snapshots.map((snapshot: { revision: string }) => snapshot.revision)).toEqual([transition === "incompatible" ? "one" : "two", "older", "one", "one"]);
    expect(snapshots[0].value).toBe("Edited after acknowledgement");
    expect(snapshots[2].conflicted).toBe(true);
    expect(fetch).toHaveBeenLastCalledWith("/api/settings", expect.objectContaining({ cache: "no-store" }));
  });

  it.each(["unauthorized", "abort"])("ignores superseded %s checks without detaching a newer check or its controller", async (completion) => {
    const requests: { resolve: (response: Response) => void; reject: (reason: Error) => void; signal: AbortSignal }[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      requests.push({ resolve, reject, signal: init.signal as AbortSignal });
    })));
    let context!: NonNullable<ReturnType<typeof useUnsavedChanges>>;
    function Access() {
      const registry = useUnsavedChanges()!;
      useLayoutEffect(() => { context = registry; }, [registry]);
      return <Editor />;
    }
    render(<UnsavedChangesProvider><Access /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "Retained draft" } });
    const oldCheck = context.verifyRevision();
    act(() => { context.beginWrite()(); });
    expect(requests[0].signal.aborted).toBe(true);
    const currentCheck = context.verifyRevision();
    await act(async () => {
      if (completion === "unauthorized") requests[0].resolve(new Response(null, { status: 401 }));
      else requests[0].reject(new DOMException("Aborted", "AbortError"));
      expect(await oldCheck).toEqual({ state: "superseded" });
    });
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Draft")).toHaveValue("Retained draft");
    expect(context.verifyRevision()).toBe(currentCheck);
    expect(requests).toHaveLength(2);
    act(() => { context.beginWrite()(); });
    expect(requests[1].signal.aborted).toBe(true);
    const newestCheck = context.verifyRevision();
    await act(async () => {
      requests[1].resolve(new Response("{}", { headers: { "x-config-revision": "old" } }));
      expect(await currentCheck).toEqual({ state: "superseded" });
    });
    expect(context.verifyRevision()).toBe(newestCheck);
    await act(async () => {
      requests[2].resolve(new Response("{}", { headers: { "x-config-revision": "current" } }));
      expect(await newestCheck).toEqual({ state: "ready", revision: "current" });
    });
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Draft")).toHaveValue("Retained draft");
  });

  it("does not let an unmounted settings owner advance retained children after a late accepted response", () => {
    let acceptLate!: () => void;
    function Owner() {
      const recovery = useDraftRecovery("settings", "one", "parent", false, () => undefined);
      return <button onClick={() => { acceptLate = () => recovery.acknowledgeRevision("late", "one"); }}>Capture completion</button>;
    }
    function Routes() {
      const [show, setShow] = useState(true);
      const context = useUnsavedChanges()!;
      return <>
        {show && <Owner />}
        <button onClick={() => { setShow(false); context.writeRecovery("settings:group-entry", { revision: "one", value: "Retained" }); }}>Leave owner</button>
        <button onClick={() => acceptLate()}>Complete late response</button>
        <output data-testid="late-child">{JSON.stringify(context.readRecovery("settings:group-entry"))}</output>
      </>;
    }
    render(<UnsavedChangesProvider><Routes /></UnsavedChangesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Capture completion" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave owner" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete late response" }));
    expect(JSON.parse(screen.getByTestId("late-child").textContent!).revision).toBe("one");
  });
});
