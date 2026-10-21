import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ServiceForm from "@/components/ServiceForm";
import BookmarkGroupForm from "@/components/BookmarkGroupForm";
import SettingsPanel from "@/components/SettingsPanel";
import { EditModeProvider, useEditMode } from "@/components/edit/EditModeProvider";
import { UnsavedChangesProvider, useUnsavedChanges } from "@/components/unsaved/UnsavedChangesProvider";
import type { KokpitConfig } from "@/config/schema";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/components/SessionManager", () => ({ default: () => null }));

const config: KokpitConfig = {
  schema_version: 2, appearance: { theme: "dark" }, auth: { enabled: false }, layout: {}, services: [], service_tiles: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(config), { headers: { "x-config-revision": "revision" } })));
});

function Leave() {
  const registry = useUnsavedChanges()!;
  return <><button onClick={() => void registry.confirm({ navigation: true }).then((ok) => { if (ok) navigation.push("/next"); })}>Leave editor</button>
    <span data-testid="dirty">{String(registry.dirty)}</span></>;
}

function revisionedSettings() {
  let revision = 1;
  let serverConfig = config;
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      expect(new Headers(init.headers).get("If-Match")).toBe(`revision-${revision}`);
      serverConfig = { ...serverConfig, ...JSON.parse(String(init.body)) };
      revision++;
    }
    return new Response(JSON.stringify(serverConfig), { headers: { "x-config-revision": `revision-${revision}` } });
  });
  vi.stubGlobal("fetch", fetchMock);
  function Routes() {
    const [show, setShow] = useState(true);
    return <><button onClick={() => setShow(!show)}>History traversal</button>
      {show && <SettingsPanel config={serverConfig} initialRevision={`revision-${revision}`} />}</>;
  }
  render(<UnsavedChangesProvider><Routes /></UnsavedChangesProvider>);
  return { fetchMock, externalChange: () => { revision++; } };
}

describe("form dismissal", () => {
  it("protects an unsubmitted service independently of a clean parent and restores focus on Stay", () => {
    const close = vi.fn();
    render(<UnsavedChangesProvider><ServiceForm service={null} existingGroups={[]} onSave={vi.fn()} onClose={close} /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Unsaved service" } });
    const closeButton = screen.getByRole("button", { name: "Close" });
    closeButton.focus();
    fireEvent.click(closeButton);
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(closeButton).toHaveFocus();
    expect(screen.getByLabelText("Name *")).toHaveValue("Unsaved service");
    expect(close).not.toHaveBeenCalled();
    const serviceDialog = screen.getByText("Add Service").closest("dialog")!;
    const escape = new Event("cancel", { cancelable: true, bubbles: false });
    fireEvent(serviceDialog, escape);
    expect(escape.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Discard and continue" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps an invalid bookmark on Save & continue and closes a valid submitted form without another warning", async () => {
    const save = vi.fn();
    render(<UnsavedChangesProvider><Leave /><BookmarkGroupForm bookmark={null} knownGroups={[]} onSave={save} onClose={vi.fn()} /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Links" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & continue" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Add at least one link");
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Link 1 name"), { target: { value: "Documentation" } });
    fireEvent.change(screen.getByLabelText("Link 1 URL"), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("dirty")).toHaveTextContent("false"));
    expect(save).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
  });

  it.each(["service", "bookmark"])("locks %s fields during a pending submission and keeps them on failure", async (kind) => {
    let finish!: (accepted: boolean) => void;
    const save = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    render(<UnsavedChangesProvider>{kind === "service"
      ? <ServiceForm service={null} existingGroups={[]} onSave={save} onClose={vi.fn()} />
      : <BookmarkGroupForm bookmark={null} knownGroups={[]} onSave={save} onClose={vi.fn()} />}</UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Submitted name" } });
    if (kind === "bookmark") {
      fireEvent.change(screen.getByLabelText("Link 1 name"), { target: { value: "Example" } });
      fireEvent.change(screen.getByLabelText("Link 1 URL"), { target: { value: "https://example.com" } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByLabelText("Name *")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "Discard and continue" })).toBeDisabled();
    await act(async () => { finish(false); });
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.getByLabelText("Name *")).toBeEnabled();
    expect(screen.getByLabelText("Name *")).toHaveValue("Submitted name");
  });
});

describe("settings draft baselines and memory recovery", () => {
  it.each(["appearance", "groups"])("recovers only the edited %s section without changing untouched URL fields", async (section) => {
    let serverConfig: KokpitConfig = {
      ...config,
      appearance: { theme: "dark", background: { image: "https://bg.example/image?signature=background-original#position" } },
      services: [{ id: "10000000-0000-4000-8000-000000000001", name: "Private views", launch_url: "https://service.example/app?view=service-original#tab", icon: "https://icons.example/service?signature=icon-original#size" }],
      service_tiles: [{ id: "20000000-0000-4000-8000-000000000001", service_id: "10000000-0000-4000-8000-000000000001" }],
      bookmarks: [{ name: "Bookmarks", links: [{ name: "Private view", url: "https://links.example/app?view=bookmark-original#tab", icon: "https://icons.example/bookmark?signature=bookmark-icon-original#size" }] }],
    };
    const original = structuredClone(serverConfig);
    const writes: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)); writes.push(body); serverConfig = { ...serverConfig, ...body };
      }
      return new Response(JSON.stringify(serverConfig), { headers: { "x-config-revision": writes.length ? "two" : "one" } });
    }));
    function Routes() {
      const [show, setShow] = useState(true);
      const context = useUnsavedChanges()!;
      return <><button onClick={() => setShow(!show)}>History traversal</button>
        <button onClick={() => void context.confirm()}>Leave all sections</button>
        <output data-testid="settings-cache">{JSON.stringify(context.readRecovery("settings")?.value)}</output>
        {show && <SettingsPanel config={serverConfig} initialRevision="one" />}</>;
    }
    render(<UnsavedChangesProvider><Routes /></UnsavedChangesProvider>);
    if (section === "appearance") fireEvent.change(screen.getByLabelText("Custom CSS"), { target: { value: ".kept {}" } });
    else {
      fireEvent.click(screen.getByRole("button", { name: "Groups" }));
      fireEvent.change(screen.getByLabelText("New group name"), { target: { value: "New group" } });
      fireEvent.click(screen.getByRole("button", { name: "+ Add group" }));
    }
    expect(screen.getByTestId("settings-cache").textContent).not.toMatch(/service-original|icon-original|bookmark-original|background-original/);
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "History traversal" })); });
    if (section === "groups") fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(screen.getByLabelText("Image URL / path")).toHaveValue(original.appearance.background!.image);
    fireEvent.click(screen.getByRole("button", { name: "Leave all sections" }));
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([section === "appearance" ? "Appearance settings" : "Groups settings"]);
    fireEvent.click(screen.getByRole("button", { name: "Save & continue" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument());
    expect(writes).toHaveLength(1);
    expect(Object.keys(writes[0]).sort()).toEqual(section === "appearance" ? ["appearance"] : ["groups", "layout"]);
    expect(serverConfig.services).toEqual(original.services);
    expect(serverConfig.service_tiles).toEqual(original.service_tiles);
    expect(serverConfig.bookmarks).toEqual(original.bookmarks);
    expect(serverConfig.appearance.background).toEqual(original.appearance.background);
  });

  it.each(["https://bg.example/image", ""])("preserves an intentional background URL edit through recovery: %s", async (edited) => {
    const initial: KokpitConfig = { ...config, appearance: { theme: "dark", background: { image: "https://bg.example/image?view=original#tab" } } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(initial), { headers: { "x-config-revision": "one" } })));
    function Routes() {
      const [show, setShow] = useState(true);
      return <><button onClick={() => setShow(!show)}>History traversal</button>
        {show && <SettingsPanel config={initial} initialRevision="one" />}</>;
    }
    render(<UnsavedChangesProvider><Routes /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Image URL / path"), { target: { value: edited } });
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "History traversal" })); });
    expect(screen.getByLabelText("Image URL / path")).toHaveValue(edited);
    expect(screen.getByText("Unsaved settings changes.", { exact: true })).toBeInTheDocument();
  });

  it("recovers a failed bookmark reorder without swapping or redacting untouched link fields", async () => {
    const initial: KokpitConfig = { ...config, bookmarks: [
      { name: "https://groups.example/first?label=first-private#label", links: [{ name: "https://names.example/same?label=first-private", description: "https://notes.example/?label=first-private", url: "https://links.example/first?key=first-private#view", icon: "https://icons.example/first?key=first-private#size" }] },
      { name: "Second", links: [{ name: "https://names.example/same?label=second-private", description: "https://notes.example/?label=second-private", url: "https://links.example/second?key=second-private#view", icon: "https://icons.example/second?key=second-private#size" }] },
    ] };
    const writes: KokpitConfig[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        writes.push(JSON.parse(String(init.body)));
        if (writes.length === 1) return new Response("{}", { status: 503 });
      }
      return new Response(JSON.stringify(initial), { headers: { "x-config-revision": "one" } });
    }));
    function Routes() {
      const [show, setShow] = useState(true);
      const context = useUnsavedChanges()!;
      return <><button onClick={() => setShow(!show)}>History traversal</button>
        <button onClick={() => void context.confirm()}>Leave all sections</button>
        <output data-testid="settings-cache">{JSON.stringify(context.readRecovery("settings")?.value)}</output>
        {show && <SettingsPanel config={initial} initialRevision="one" />}</>;
    }
    render(<UnsavedChangesProvider><Routes /></UnsavedChangesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Bookmarks" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: `Move ${initial.bookmarks![0].name} down` })); });
    expect(screen.getByTestId("settings-cache").textContent).not.toMatch(/first-private|second-private/);
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "History traversal" })); });
    fireEvent.click(screen.getByRole("button", { name: "Leave all sections" }));
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Bookmarks settings"]);
    fireEvent.click(screen.getByRole("button", { name: "Save & continue" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument());
    expect(writes).toHaveLength(2);
    expect(writes[1].bookmarks).toEqual([initial.bookmarks![1], initial.bookmarks![0]]);
  });

  it("keeps normalized legacy identities through failed reorders and appearance-only recovery", async () => {
    const initial = { ...config, services: [
      { name: "First", launch_url: "https://legacy.example/first?view=original#one", icon: "https://legacy.example/icon?key=original", group: "Media" },
      { name: "Second", launch_url: "https://legacy.example/second?view=original#two", group: "Media" },
    ], service_tiles: [] } as unknown as KokpitConfig;
    const writes: KokpitConfig[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { writes.push(JSON.parse(String(init.body))); return new Response("{}", { status: 503 }); }
      return new Response(JSON.stringify(initial), { headers: { "x-config-revision": "one" } });
    }));
    function Routes() {
      const [show, setShow] = useState(true);
      const context = useUnsavedChanges()!;
      return <><button onClick={() => setShow(!show)}>History traversal</button>
        <button onClick={() => void context.confirm()}>Leave all sections</button>
        {show && <SettingsPanel config={initial} initialRevision="one" />}</>;
    }
    render(<UnsavedChangesProvider><Routes /></UnsavedChangesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Services" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Move First down" })); });
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    fireEvent.change(screen.getByLabelText("Custom CSS"), { target: { value: ".legacy {}" } });
    fireEvent.click(screen.getByRole("button", { name: "Services" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Move First down" })); });
    expect(writes).toHaveLength(2);
    expect(writes[1].services).toEqual(writes[0].services);
    expect(writes[1].service_tiles).toEqual(writes[0].service_tiles);
    expect(writes[1].services.find((service) => service.name === "First")).toMatchObject({
      launch_url: initial.services[0].launch_url, icon: initial.services[0].icon,
    });
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "History traversal" })); });
    fireEvent.click(screen.getByRole("button", { name: "Leave all sections" }));
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Appearance settings"]);
  });

  it("keeps authorized URL-shaped group identities for a recovered rename cascade", async () => {
    const originalName = "https://groups.example/Media?view=original#section";
    const initial: KokpitConfig = { ...config, groups: [{ name: originalName }],
      services: [{ id: "10000000-0000-4000-8000-000000000001", name: "Service", launch_url: "https://service.example?view=original" }],
      service_tiles: [{ id: "20000000-0000-4000-8000-000000000001", service_id: "10000000-0000-4000-8000-000000000001", group: originalName }],
      bookmarks: [{ name: "Links", placement: { group: originalName }, links: [{ name: "One", url: "https://links.example?view=original" }] }],
    };
    const writes: Partial<KokpitConfig>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") writes.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(initial), { headers: { "x-config-revision": "one" } });
    }));
    function Routes() {
      const [show, setShow] = useState(true);
      return <><button onClick={() => setShow(!show)}>History traversal</button>
        {show && <SettingsPanel config={initial} initialRevision="one" />}</>;
    }
    render(<UnsavedChangesProvider><Routes /></UnsavedChangesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    fireEvent.change(screen.getByLabelText(`Group name for ${originalName}`), { target: { value: "Renamed" } });
    fireEvent.blur(screen.getByLabelText(`Group name for ${originalName}`));
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "History traversal" })); });
    expect(screen.getByLabelText("Group name for Renamed")).toHaveValue("Renamed");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(writes).toHaveLength(1);
    expect(writes[0].groups).toEqual([{ name: "Renamed" }]);
    expect(writes[0].service_tiles?.[0].group).toBe("Renamed");
    expect(writes[0].bookmarks?.[0]).toEqual({ ...initial.bookmarks![0], placement: { group: "Renamed" } });
  });

  it("rechecks a retained group after an appearance write without reusing an older pending revision request", async () => {
    let finishOldCheck!: (response: Response) => void;
    let revision = "one";
    let revisionReads = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        expect(new Headers(init.headers).get("If-Match")).toBe("one");
        revision = "two";
      } else if (++revisionReads === 1) {
        return new Promise<Response>((resolve) => { finishOldCheck = resolve; });
      }
      return new Response(JSON.stringify(config), { headers: { "x-config-revision": revision } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<UnsavedChangesProvider><SettingsPanel config={config} initialRevision="one" /></UnsavedChangesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    fireEvent.change(screen.getByLabelText("New group name"), { target: { value: "Retained through write" } });
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    expect(revisionReads).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    fireEvent.change(screen.getByLabelText("Custom CSS"), { target: { value: ".accepted {}" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Groups" })); });
    await act(async () => { finishOldCheck(new Response("{}", { headers: { "x-config-revision": "one" } })); });
    expect(screen.getByLabelText("New group name")).toHaveValue("Retained through write");
    expect(screen.queryByRole("button", { name: "Discard recovered group name" })).not.toBeInTheDocument();
    expect(revisionReads).toBe(2);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "+ Add group" }));
    expect(screen.getByLabelText("Group name for Retained through write")).toHaveValue("Retained through write");
  });

  it("keeps a retained new group usable after an accepted appearance save and history return", async () => {
    const { fetchMock } = revisionedSettings();
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    fireEvent.change(screen.getByLabelText("New group name"), { target: { value: "Retained group" } });
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    fireEvent.change(screen.getByLabelText("Custom CSS"), { target: { value: ".accepted {}" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Groups" })); });
    expect(screen.getByLabelText("New group name")).toHaveValue("Retained group");
    expect(screen.queryByRole("button", { name: "Discard recovered group name" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Add group" }));
    expect(screen.getByLabelText("Group name for Retained group")).toHaveValue("Retained group");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2);
  });

  it("does not advance an older external child draft through a later accepted appearance write", async () => {
    const server = revisionedSettings();
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    fireEvent.change(screen.getByLabelText("New group name"), { target: { value: "Older draft" } });
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    server.externalChange();
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    fireEvent.change(screen.getByLabelText("Custom CSS"), { target: { value: ".newer {}" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Groups" })); });
    expect(screen.getByLabelText("New group name")).toHaveValue("Older draft");
    expect(screen.getByRole("button", { name: "Discard recovered group name" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Add group" }));
    expect(screen.queryByLabelText("Group name for Older draft")).not.toBeInTheDocument();
  });

  it("keeps child drafts on their old baseline after a groups/layout write", async () => {
    revisionedSettings();
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    fireEvent.change(screen.getByLabelText("New group name"), { target: { value: "Review after group write" } });
    fireEvent.change(screen.getByLabelText("Ungrouped position"), { target: { value: "first" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Groups" })); });
    expect(screen.getByLabelText("New group name")).toHaveValue("Review after group write");
    expect(screen.getByRole("button", { name: "Discard recovered group name" })).toBeInTheDocument();
  });

  it("saving one section preserves other unsaved sections and a reverted value clears its warning", async () => {
    render(<UnsavedChangesProvider><Leave /><SettingsPanel config={config} initialRevision="one" /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Custom CSS"), { target: { value: ".tile { color: red }" } });
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    fireEvent.change(screen.getByLabelText("New group name"), { target: { value: "Media" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add group" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Saved/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(screen.getByLabelText("Custom CSS")).toHaveValue(".tile { color: red }");
    fireEvent.click(screen.getByRole("button", { name: "Leave editor" }));
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toHaveTextContent("Appearance settings");
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    fireEvent.change(screen.getByLabelText("Custom CSS"), { target: { value: "" } });
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
  });

  it("keeps settings inputs locked while a write is pending and clears only its acknowledged work", async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<UnsavedChangesProvider><Leave /><SettingsPanel config={config} initialRevision="one" /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Custom CSS"), { target: { value: "submitted" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.change(screen.getByLabelText("Custom CSS"), { target: { value: "newer edit" } });
    await act(async () => { finish(new Response(JSON.stringify({ ...config, appearance: { theme: "dark", custom_css: "submitted" } }), { headers: { "x-config-revision": "two" } })); });
    expect(screen.getByLabelText("Custom CSS")).toHaveValue("submitted");
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
  });

  it("recovers settings and open form text on history return, excludes credentials, and blocks a changed baseline", async () => {
    function Routes() {
      const [show, setShow] = useState(true);
      const [revision, setRevision] = useState("one");
      return <><button onClick={() => setShow(!show)}>History traversal</button>
        <button onClick={() => setRevision("two")}>External revision</button>
        {show && <SettingsPanel config={config} initialRevision={revision} />}</>;
    }
    render(<UnsavedChangesProvider><Routes /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Custom CSS"), { target: { value: ".kept {}" } });
    fireEvent.click(screen.getByRole("button", { name: "Services" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add Service" }));
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Retained name" } });
    fireEvent.change(screen.getByLabelText("Integration", { exact: true }), { target: { value: "qbittorrent" } });
    fireEvent.change(screen.getByLabelText("Password *", { exact: true }), { target: { value: "synthetic-not-retained" } });
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    fireEvent.click(screen.getByRole("button", { name: "External revision" }));
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    expect(screen.getByLabelText("Name *")).toHaveValue("Retained name");
    expect(screen.getByLabelText("Password *", { exact: true })).toHaveValue("");
    expect(screen.getByText(/Recovered basic service fields/)).toBeInTheDocument();
    expect(screen.getAllByRole("alert").some((element) => element.textContent?.includes("Settings changed or could not be verified"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard and continue" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    expect(screen.getByLabelText("Custom CSS")).toHaveValue(".kept {}");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("refetches 2FA status after discarding account fields while the auth tab stays active", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ enabled: true })));
    vi.stubGlobal("fetch", fetchMock);
    function DiscardSettings() {
      const context = useUnsavedChanges()!;
      return <button onClick={() => void context.confirm({ scope: "settings" })}>Discard local settings</button>;
    }
    render(<UnsavedChangesProvider><DiscardSettings /><SettingsPanel config={config} initialRevision="one" /></UnsavedChangesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Auth" }));
    fireEvent.click(await screen.findByRole("button", { name: "Disable 2FA" }));
    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard local settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard and continue" }));
    expect(await screen.findByRole("button", { name: "Disable 2FA" })).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Authenticator code")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function DashboardEditor() {
  const edit = useEditMode();
  return <><button onClick={() => void edit.enter()}>Enter</button>
    <button onClick={() => edit.updateDraft({ appearance: { theme: "light" } })}>Change</button>
    <button onClick={() => edit.updateDraft({ appearance: { theme: "oled" } })}>Change again</button>
    <button onClick={edit.toggle}>Toggle</button>
    <span data-testid="active">{String(edit.active)}</span><span data-testid="draft-theme">{edit.draft?.appearance.theme}</span></>;
}

describe("dashboard edit exit", () => {
  it("guards the edit toggle and preserves its draft when Stay is selected", async () => {
    render(<UnsavedChangesProvider><EditModeProvider canEdit connectionTestingEnabled><DashboardEditor /></EditModeProvider></UnsavedChangesProvider>);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enter" })); });
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.getByTestId("active")).toHaveTextContent("true");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("active")).toHaveTextContent("false");
  });

  it("keeps later dashboard edits when a submitted snapshot finishes saving", async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation((_url, options) => options?.method === "PATCH"
      ? new Promise((resolve) => { finish = resolve; })
      : Promise.resolve(new Response(JSON.stringify(config), { headers: { "x-config-revision": "one" } })));
    render(<UnsavedChangesProvider><EditModeProvider canEdit connectionTestingEnabled><DashboardEditor /></EditModeProvider></UnsavedChangesProvider>);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enter" })); });
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & exit" }));
    fireEvent.click(screen.getByRole("button", { name: "Change again" }));
    await act(async () => { finish(new Response("{}", { headers: { "x-config-revision": "two" } })); });
    expect(screen.getByTestId("active")).toHaveTextContent("true");
    expect(screen.getByTestId("draft-theme")).toHaveTextContent("oled");
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
  });
});
