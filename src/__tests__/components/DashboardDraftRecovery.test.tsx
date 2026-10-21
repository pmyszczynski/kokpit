import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditModeProvider, useEditMode } from "@/components/edit/EditModeProvider";
import EditableServiceGrid from "@/components/edit/EditableServiceGrid";
import { UnsavedChangesProvider, useUnsavedChanges } from "@/components/unsaved/UnsavedChangesProvider";
import type { KokpitConfig } from "@/config/schema";

vi.mock("next/navigation", () => {
  const router = { refresh: vi.fn() };
  return { useRouter: () => router };
});

const config: KokpitConfig = {
  schema_version: 2, appearance: { theme: "dark" }, auth: { enabled: false },
  layout: {}, services: [], service_tiles: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(config), { headers: { "x-config-revision": "one" } })));
});

function Dashboard() {
  const edit = useEditMode();
  const unsaved = useUnsavedChanges()!;
  const [visible, setVisible] = useState(true);
  return <>
    <button onClick={() => void edit.enter()}>Enter dashboard</button>
    <button onClick={edit.discard}>Discard dashboard</button>
    <button onClick={() => void edit.reload()}>Reload dashboard</button>
    <button onClick={() => setVisible(!visible)}>History traversal</button>
    <button onClick={() => unsaved.writeRecovery("settings:fixture", { revision: "one", value: "Unrelated settings draft", dirty: true })}>Retain settings</button>
    <span data-testid="active">{String(edit.active)}</span>
    <span data-testid="settings-recovery">{String(unsaved.readRecovery("settings:fixture")?.value ?? "")}</span>
    {edit.active && visible && edit.draft && <EditableServiceGrid config={edit.draft} />}
  </>;
}

function setup() {
  render(<UnsavedChangesProvider><EditModeProvider canEdit connectionTestingEnabled><Dashboard /></EditModeProvider></UnsavedChangesProvider>);
}

async function enter() {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enter dashboard" })); });
}

function addService() {
  fireEvent.click(screen.getByRole("button", { name: "Add tile" }));
  fireEvent.click(screen.getByRole("button", { name: /Blank service/ }));
}

describe("explicit dashboard recovery cleanup", () => {
  it("retains normal history recovery, then clears discarded dashboard drafts without clearing settings", async () => {
    setup();
    await enter();
    addService();
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Discarded service" } });
    fireEvent.click(screen.getByRole("button", { name: "Retain settings" }));

    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "History traversal" })); });
    expect(screen.getByLabelText("Name *")).toHaveValue("Discarded service");

    fireEvent.click(screen.getByRole("button", { name: "Discard dashboard" }));
    expect(screen.getByTestId("active")).toHaveTextContent("false");
    expect(screen.getByTestId("settings-recovery")).toHaveTextContent("Unrelated settings draft");
    await enter();
    expect(screen.queryByLabelText("Name *")).not.toBeInTheDocument();
    addService();
    expect(screen.getByLabelText("Name *")).toHaveValue("");
    expect(screen.getByTestId("settings-recovery")).toHaveTextContent("Unrelated settings draft");
  });

  it("closes a pristine dialog after an explicit reload even when the revision is unchanged", async () => {
    setup();
    await enter();
    addService();
    expect(screen.getByLabelText("Name *")).toHaveValue("");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reload dashboard" })); });
    expect(screen.queryByLabelText("Name *")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "History traversal" })); });
    expect(screen.queryByLabelText("Name *")).not.toBeInTheDocument();
  });
});
