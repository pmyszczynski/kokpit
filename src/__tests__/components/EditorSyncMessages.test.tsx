import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GroupsTab from "@/components/GroupsTab";
import ServiceForm from "@/components/ServiceForm";
import BookmarkGroupForm from "@/components/BookmarkGroupForm";
import { UnsavedChangesProvider } from "@/components/unsaved/UnsavedChangesProvider";

const sync = vi.hoisted(() => ({ revision: "one", available: true, editable: true }));
vi.mock("@/components/ConfigurationSyncProvider", () => ({
  useConfigurationSync: () => ({ ...sync, stale: (baseline: string | null | undefined) => baseline !== sync.revision }),
}));
vi.mock("next/navigation", () => {
  const router = { refresh: vi.fn() };
  return { useRouter: () => router };
});

beforeEach(() => {
  Object.assign(sync, { revision: "one", available: true, editable: true });
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; });
});

function GroupEditor({ revision, onRename, onAdd }: {
  revision: string;
  onRename: (oldName: string, name: string) => void;
  onAdd: (name: string) => void;
}) {
  const [groups, setGroups] = useState([{ name: "Media" }]);
  return <UnsavedChangesProvider><GroupsTab groups={groups} baselineRevision={revision}
    undeclaredGroups={[]} ungrouped="last" saveStatus="idle" onReorder={vi.fn()}
    onToggleCollapsed={vi.fn()} onDelete={vi.fn()} onDeclare={vi.fn()} onAdd={onAdd}
    onUngroupedChange={vi.fn()} onSave={vi.fn()} onRename={(oldName, name) => {
      onRename(oldName, name);
      setGroups((current) => current.map((group) => group.name === oldName ? { name } : group));
    }} /></UnsavedChangesProvider>;
}

describe("configuration-blocked editor guidance", () => {
  it("explains a blocked group rename after the shared revision advances without rebasing its draft", () => {
    const onRename = vi.fn();
    const onAdd = vi.fn();
    const view = render(<GroupEditor revision="one" onRename={onRename} onAdd={onAdd} />);
    fireEvent.change(screen.getByLabelText("Group name for Media"), { target: { value: "Kept rename" } });
    sync.revision = "two";
    view.rerender(<GroupEditor revision="two" onRename={onRename} onAdd={onAdd} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Settings changed or could not be verified/);
    expect(screen.getByLabelText("Group name for Media")).toHaveValue("Kept rename");
    fireEvent.keyDown(screen.getByLabelText("Group name for Media"), { key: "Enter" });
    fireEvent.blur(screen.getByLabelText("Group name for Media"));
    expect(onRename).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard group name draft" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Group name for Media")).toHaveValue("Media");
    fireEvent.change(screen.getByLabelText("Group name for Media"), { target: { value: "Fresh rename" } });
    fireEvent.keyDown(screen.getByLabelText("Group name for Media"), { key: "Enter" });
    expect(onRename).toHaveBeenCalledExactlyOnceWith("Media", "Fresh rename");
  });

  it("explains a blocked new group and allows an explicit discard before a fresh entry", () => {
    const onRename = vi.fn();
    const onAdd = vi.fn();
    const view = render(<GroupEditor revision="one" onRename={onRename} onAdd={onAdd} />);
    fireEvent.change(screen.getByLabelText("New group name"), { target: { value: "Kept new group" } });
    sync.revision = "two";
    view.rerender(<GroupEditor revision="two" onRename={onRename} onAdd={onAdd} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Settings changed or could not be verified/);
    fireEvent.keyDown(screen.getByLabelText("New group name"), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "+ Add group" }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByLabelText("New group name")).toHaveValue("Kept new group");
    fireEvent.click(screen.getByRole("button", { name: "Discard new group name draft" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("New group name")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("New group name"), { target: { value: "Fresh group" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add group" }));
    expect(onAdd).toHaveBeenCalledExactlyOnceWith("Fresh group");
  });

  it.each(["service", "bookmark"])("identifies a migration-required %s form as read-only", (kind) => {
    sync.editable = false;
    const onSave = vi.fn();
    render(<UnsavedChangesProvider>{kind === "service"
      ? <ServiceForm service={null} existingGroups={[]} baselineRevision="one" onSave={onSave} onClose={vi.fn()} />
      : <BookmarkGroupForm bookmark={null} knownGroups={[]} baselineRevision="one" onSave={onSave} onClose={vi.fn()} />
    }</UnsavedChangesProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent(/read-only.*migration/i);
    expect(screen.getByLabelText("Name *")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.submit(screen.getByLabelText("Name *").closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
  });
});
