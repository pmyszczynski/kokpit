import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GroupsTab from "@/components/GroupsTab";
import { UnsavedChangesProvider, useUnsavedChanges } from "@/components/unsaved/UnsavedChangesProvider";
import type { Group } from "@/config/schema";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); });
});

function Editor({ onRename, onLeave = vi.fn(), onAdd = vi.fn(), initialGroups = [{ name: "First" }, { name: "Second" }] }: {
  onRename: (oldName: string, name: string) => void;
  onLeave?: () => void;
  onAdd?: (name: string) => void;
  initialGroups?: Group[];
}) {
  const [groups, setGroups] = useState<Group[]>(initialGroups);
  const unsaved = useUnsavedChanges()!;
  return <>
    <span data-testid="dirty">{String(unsaved.dirty)}</span>
    <button onClick={() => void unsaved.confirm({ scope: "settings" }).then((allowed) => { if (allowed) onLeave(); })}>Leave groups</button>
    <GroupsTab groups={groups} undeclaredGroups={[]} ungrouped="last" saveStatus="idle"
      onReorder={vi.fn()} onToggleCollapsed={vi.fn()} onDelete={vi.fn()} onDeclare={vi.fn()}
      onAdd={onAdd} onUngroupedChange={vi.fn()} onSave={vi.fn()}
      onRename={(oldName, name) => {
        onRename(oldName, name);
        if (groups.some((group) => group.name !== oldName && group.name.toLowerCase() === name.toLowerCase())) return;
        setGroups((current) => current.map((group) => group.name === oldName ? { ...group, name } : group));
      }} />
  </>;
}

describe("GroupsTab validation", () => {
  it("keeps an untouched padded group name clean during guarded navigation", async () => {
    const onRename = vi.fn();
    const onLeave = vi.fn();
    render(<UnsavedChangesProvider><Editor initialGroups={[{ name: " Media " }]} onRename={onRename} onLeave={onLeave} /></UnsavedChangesProvider>);
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
    fireEvent.click(screen.getByRole("button", { name: "Leave groups" }));
    await waitFor(() => expect(onLeave).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Group name for Media")).toHaveValue(" Media ");
  });

  it.each(["blur", "Enter"])("preserves the original padded name on %s without a rename", (action) => {
    const onRename = vi.fn();
    render(<UnsavedChangesProvider><Editor initialGroups={[{ name: " Media " }]} onRename={onRename} /></UnsavedChangesProvider>);
    const input = screen.getByLabelText("Group name for Media");
    if (action === "blur") fireEvent.blur(input);
    else fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
    expect(input).toHaveValue(" Media ");
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
  });

  it("does not normalize an untouched padded name while saving another group draft", async () => {
    const onRename = vi.fn();
    const onLeave = vi.fn();
    const onAdd = vi.fn();
    render(<UnsavedChangesProvider><Editor initialGroups={[{ name: " Media " }]} onRename={onRename} onLeave={onLeave} onAdd={onAdd} /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("New group name"), { target: { value: "New group" } });
    fireEvent.click(screen.getByRole("button", { name: "Leave groups" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & continue" }));
    await waitFor(() => expect(onLeave).toHaveBeenCalledOnce());
    expect(onAdd).toHaveBeenCalledExactlyOnceWith("New group");
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Group name for Media")).toHaveValue(" Media ");
  });

  it("keeps whitespace-only adjustments to a padded name clean and restores its original text", () => {
    const onRename = vi.fn();
    render(<UnsavedChangesProvider><Editor initialGroups={[{ name: " Media " }]} onRename={onRename} /></UnsavedChangesProvider>);
    const input = screen.getByLabelText("Group name for Media");
    fireEvent.change(input, { target: { value: "  Media  " } });
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
    fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();
    expect(input).toHaveValue(" Media ");
  });

  it("rejects an empty rename, then commits a real rename from a padded name", () => {
    const onRename = vi.fn();
    render(<UnsavedChangesProvider><Editor initialGroups={[{ name: " Media " }]} onRename={onRename} /></UnsavedChangesProvider>);
    const input = screen.getByLabelText("Group name for Media");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();
    expect(input).toHaveValue(" Media ");
    fireEvent.change(input, { target: { value: "  Movies  " } });
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledExactlyOnceWith(" Media ", "Movies");
    expect(screen.getByLabelText("Group name for Movies")).toHaveValue("Movies");
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");
  });

  it("rejects a duplicate rename during Save & continue and permits a corrected name", async () => {
    const onRename = vi.fn();
    const onLeave = vi.fn();
    render(<UnsavedChangesProvider><Editor onRename={onRename} onLeave={onLeave} /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Group name for First"), { target: { value: " second " } });
    fireEvent.click(screen.getByRole("button", { name: "Leave groups" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & continue" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("A group with this name already exists.");
    expect(onRename).not.toHaveBeenCalled();
    expect(onLeave).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Group name for First")).toHaveValue(" second ");
    fireEvent.change(screen.getByLabelText("Group name for First"), { target: { value: "Third" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Leave groups" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & continue" }));
    await waitFor(() => expect(onLeave).toHaveBeenCalledOnce());
    expect(onRename).toHaveBeenCalledExactlyOnceWith("First", "Third");
    expect(screen.getByLabelText("Group name for Third")).toHaveValue("Third");
  });

  it("allows a case-only group rename", () => {
    const onRename = vi.fn();
    render(<UnsavedChangesProvider><Editor onRename={onRename} /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Group name for First"), { target: { value: "first" } });
    fireEvent.blur(screen.getByLabelText("Group name for First"));
    expect(onRename).toHaveBeenCalledExactlyOnceWith("First", "first");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears a duplicate new-group error as the name is edited", () => {
    const onAdd = vi.fn();
    render(<UnsavedChangesProvider><Editor onRename={vi.fn()} onAdd={onAdd} /></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("New group name"), { target: { value: " second " } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add group" }));
    expect(screen.getByRole("alert")).toHaveTextContent("already exists");
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("New group name"), { target: { value: "Third" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Add group" }));
    expect(onAdd).toHaveBeenCalledExactlyOnceWith("Third");
  });
});
