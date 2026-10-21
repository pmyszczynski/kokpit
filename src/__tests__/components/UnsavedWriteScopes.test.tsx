import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPanel from "@/components/SettingsPanel";
import { EditModeProvider, useEditMode } from "@/components/edit/EditModeProvider";
import { UnsavedChangesProvider, useUnsavedChanges } from "@/components/unsaved/UnsavedChangesProvider";
import type { KokpitConfig } from "@/config/schema";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/SessionManager", () => ({ default: () => null }));

const navigation = vi.fn();
const config: KokpitConfig = {
  schema_version: 2, appearance: { theme: "dark" }, auth: { enabled: false },
  layout: {}, services: [], service_tiles: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); });
  let current = config;
  let revision = 1;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const headers = new Headers({ "x-config-revision": `revision-${revision}` });
    if (init?.method === "PATCH") {
      if (new Headers(init.headers).get("If-Match") !== `revision-${revision}`) {
        return new Response(JSON.stringify({ code: "revision_mismatch" }), { status: 409, headers });
      }
      current = { ...current, ...JSON.parse(String(init.body)) };
      revision++;
    }
    return new Response(JSON.stringify(current), { headers: { "x-config-revision": `revision-${revision}` } });
  }));
});

function Editors() {
  const edit = useEditMode();
  const unsaved = useUnsavedChanges()!;
  const [settings, setSettings] = useState(false);
  return <>
    <button onClick={() => void edit.enter()}>Enter dashboard</button>
    <button onClick={() => edit.updateDraft({ appearance: { theme: "light" } })}>Change dashboard</button>
    <button onClick={() => setSettings(true)}>Open settings</button>
    <button onClick={() => void unsaved.confirm().then((allowed) => { if (allowed) navigation(); })}>Leave all drafts</button>
    <span data-testid="dashboard-theme">{edit.draft?.appearance.theme}</span>
    {settings && <SettingsPanel config={config} initialRevision="revision-1" />}
  </>;
}

function setup() {
  render(<UnsavedChangesProvider><EditModeProvider canEdit connectionTestingEnabled><Editors /></EditModeProvider></UnsavedChangesProvider>);
}

function writes() {
  return vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH");
}

describe("aggregate unsaved write boundaries", () => {
  it("keeps mixed dashboard/settings drafts separate before either revision is written", async () => {
    setup();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enter dashboard" })); });
    fireEvent.click(screen.getByRole("button", { name: "Change dashboard" }));
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.change(screen.getByLabelText("Custom CSS"), { target: { value: ".kept {}" } });
    fireEvent.click(screen.getByRole("button", { name: "Leave all drafts" }));
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toHaveTextContent("Dashboard layout");
    expect(screen.queryByRole("button", { name: "Save & continue" })).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.getByTestId("dashboard-theme")).toHaveTextContent("light");
    expect(screen.getByLabelText("Custom CSS")).toHaveValue(".kept {}");
    expect(navigation).not.toHaveBeenCalled();
  });

  it("allows independent sections of one settings editor to save in revision order", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    fireEvent.change(screen.getByLabelText("Custom CSS"), { target: { value: ".kept {}" } });
    fireEvent.click(screen.getByRole("button", { name: "Groups" }));
    fireEvent.change(screen.getByLabelText("New group name"), { target: { value: "Kept group" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add group" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave all drafts" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & continue" }));
    await waitFor(() => expect(navigation).toHaveBeenCalledOnce());
    expect(writes()).toHaveLength(2);
    expect(writes().map(([, init]) => new Headers(init?.headers).get("If-Match"))).toEqual(["revision-1", "revision-2"]);
    expect(writes().map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { appearance: { theme: "dark", custom_css: ".kept {}" } },
      { groups: [{ name: "Kept group" }], layout: {} },
    ]);
  });
});
