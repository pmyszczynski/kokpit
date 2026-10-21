import { useState, type ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ServiceForm from "@/components/ServiceForm";
import BookmarkGroupForm from "@/components/BookmarkGroupForm";
import { UnsavedChangesProvider, useUnsavedChanges } from "@/components/unsaved/UnsavedChangesProvider";

const navigation = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

const service = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Original service",
  url: "https://host/app?view=fixture-original#fixture-section",
  icon: "/proxy/icon?token=fixture-original#fixture-icon",
};
const bookmark = {
  name: "Original bookmarks",
  links: [
    { name: "First", url: "https://first/app?view=fixture-first#first", icon: "/first?token=fixture-first#first" },
    { name: "Second", url: "https://second/app?view=fixture-second#second", icon: "/second?token=fixture-second#second" },
  ],
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "x-config-revision": "one" } })));
});

function RecoveryProbe({ id, read }: { id: string; read: (value: unknown) => void }) {
  const unsaved = useUnsavedChanges()!;
  return <button onClick={() => read(unsaved.readRecovery(id)?.value)}>Read recovery</button>;
}

function Routes({ children }: { children: ReactNode }) {
  const [show, setShow] = useState(true);
  return <><button onClick={() => setShow(!show)}>History traversal</button>{show && children}</>;
}

async function traverse() {
  fireEvent.click(screen.getByRole("button", { name: "History traversal" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "History traversal" })); });
}

describe("form recovery field provenance", () => {
  it("preserves untouched service URL/icon fields without retaining them in recovery", async () => {
    const onSave = vi.fn();
    const read = vi.fn();
    render(<UnsavedChangesProvider>
      <RecoveryProbe id={`dashboard:service-form:${service.id}`} read={read} />
      <Routes><ServiceForm service={service} existingGroups={[]} onSave={onSave} onClose={vi.fn()} baselineRevision="one" /></Routes>
    </UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Renamed service" } });
    fireEvent.click(screen.getByRole("button", { name: "Read recovery" }));
    expect(JSON.stringify(read.mock.calls[0][0])).not.toContain("fixture-original");
    await traverse();
    await traverse();
    expect(screen.getByLabelText("URL", { exact: true })).toHaveValue(service.url);
    expect(screen.getByLabelText("Icon URL")).toHaveValue(service.icon);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Renamed service", url: service.url, icon: service.icon })));
  });

  it.each([
    { url: "https://host/app", icon: "/edited?token=fixture-edited#edited", recoveredIcon: "/edited" },
    { url: "", icon: "", recoveredIcon: "" },
  ])("keeps intentional service query/fragment removal or clearing across repeated recovery: %o", async (edited) => {
    const onSave = vi.fn();
    render(<UnsavedChangesProvider><Routes><ServiceForm service={service} existingGroups={[]} onSave={onSave} onClose={vi.fn()} baselineRevision="one" /></Routes></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("URL", { exact: true }), { target: { value: edited.url } });
    fireEvent.change(screen.getByLabelText("Icon URL"), { target: { value: edited.icon } });
    await traverse();
    await traverse();
    expect(screen.getByLabelText("URL", { exact: true })).toHaveValue(edited.url);
    expect(screen.getByLabelText("Icon URL")).toHaveValue(edited.recoveredIcon);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ url: edited.url || undefined, icon: edited.recoveredIcon || undefined })));
  });

  it("treats service fields reverted to their authorized originals as unchanged", async () => {
    render(<UnsavedChangesProvider><Routes><ServiceForm service={service} existingGroups={[]} onSave={vi.fn()} onClose={vi.fn()} baselineRevision="one" /></Routes></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Renamed service" } });
    fireEvent.change(screen.getByLabelText("URL", { exact: true }), { target: { value: "https://edited/app" } });
    fireEvent.change(screen.getByLabelText("Icon URL"), { target: { value: "/edited" } });
    await traverse();
    fireEvent.change(screen.getByLabelText("URL", { exact: true }), { target: { value: service.url } });
    fireEvent.change(screen.getByLabelText("Icon URL"), { target: { value: service.icon } });
    await traverse();
    expect(screen.getByLabelText("URL", { exact: true })).toHaveValue(service.url);
    expect(screen.getByLabelText("Icon URL")).toHaveValue(service.icon);
  });

  it("keeps each untouched bookmark URL/icon attached to its original row after reordering", async () => {
    const onSave = vi.fn();
    const read = vi.fn();
    render(<UnsavedChangesProvider>
      <RecoveryProbe id="dashboard:bookmark-form:Original bookmarks" read={read} />
      <Routes><BookmarkGroupForm bookmark={bookmark} knownGroups={[]} onSave={onSave} onClose={vi.fn()} baselineRevision="one" /></Routes>
    </UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Renamed bookmarks" } });
    fireEvent.click(screen.getByRole("button", { name: "Move link Second up" }));
    fireEvent.change(screen.getByLabelText("Link 1 name"), { target: { value: "Renamed second" } });
    fireEvent.click(screen.getByRole("button", { name: "Read recovery" }));
    expect(JSON.stringify(read.mock.calls[0][0])).not.toContain("fixture-");
    await traverse();
    await traverse();
    expect(screen.getByLabelText("Link 1 name")).toHaveValue("Renamed second");
    expect(screen.getByLabelText("Link 1 URL")).toHaveValue(bookmark.links[1].url);
    expect(screen.getByLabelText("Link 1 icon")).toHaveValue(bookmark.links[1].icon);
    expect(screen.getByLabelText("Link 2 URL")).toHaveValue(bookmark.links[0].url);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ links: [expect.objectContaining({ ...bookmark.links[1], name: "Renamed second" }), expect.objectContaining(bookmark.links[0])] })));
  });

  it("preserves edited bookmark fields, redacts secrets and restores the correct row after removal", async () => {
    const onSave = vi.fn();
    render(<UnsavedChangesProvider><Routes><BookmarkGroupForm bookmark={bookmark} knownGroups={[]} onSave={onSave} onClose={vi.fn()} baselineRevision="one" /></Routes></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Link 2 URL"), { target: { value: "https://second/app" } });
    fireEvent.change(screen.getByLabelText("Link 2 icon"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove link First" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add link" }));
    fireEvent.change(screen.getByLabelText("Link 2 name"), { target: { value: "New link" } });
    fireEvent.change(screen.getByLabelText("Link 2 URL"), { target: { value: "https://new/app?token=fixture-new#new" } });
    fireEvent.change(screen.getByLabelText("Link 2 icon"), { target: { value: "/new?token=fixture-new#new" } });
    await traverse();
    await traverse();
    expect(screen.getByLabelText("Link 1 name")).toHaveValue("Second");
    expect(screen.getByLabelText("Link 1 URL")).toHaveValue("https://second/app");
    expect(screen.getByLabelText("Link 1 icon")).toHaveValue("");
    expect(screen.getByLabelText("Link 2 URL")).toHaveValue("https://new/app");
    expect(screen.getByLabelText("Link 2 icon")).toHaveValue("/new");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ links: [
      expect.objectContaining({ name: "Second", url: "https://second/app", icon: undefined }),
      expect.objectContaining({ name: "New link", url: "https://new/app", icon: "/new" }),
    ] })));
  });

  it("treats bookmark fields reverted to their authorized originals as unchanged", async () => {
    render(<UnsavedChangesProvider><Routes><BookmarkGroupForm bookmark={bookmark} knownGroups={[]} onSave={vi.fn()} onClose={vi.fn()} baselineRevision="one" /></Routes></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Renamed bookmarks" } });
    fireEvent.change(screen.getByLabelText("Link 1 URL"), { target: { value: "https://edited/app" } });
    fireEvent.change(screen.getByLabelText("Link 1 icon"), { target: { value: "/edited" } });
    await traverse();
    fireEvent.change(screen.getByLabelText("Link 1 URL"), { target: { value: bookmark.links[0].url } });
    fireEvent.change(screen.getByLabelText("Link 1 icon"), { target: { value: bookmark.links[0].icon } });
    await traverse();
    expect(screen.getByLabelText("Link 1 URL")).toHaveValue(bookmark.links[0].url);
    expect(screen.getByLabelText("Link 1 icon")).toHaveValue(bookmark.links[0].icon);
  });

  it.each([false, true])("preserves provenance for URL-shaped service text fields (explicit edits: %s)", async (edited) => {
    const original = { ...service, name: "https://name/value?view=fixture-name#name",
      description: "https://description/value?view=fixture-description#description", group: "https://group/value?view=fixture-group#group" };
    const expected = edited ? { name: "https://name/value", description: "https://description/value", group: "https://group/value" }
      : { name: original.name, description: original.description, group: original.group };
    const onSave = vi.fn();
    const read = vi.fn();
    render(<UnsavedChangesProvider>
      <RecoveryProbe id={`dashboard:service-form:${service.id}`} read={read} />
      <Routes><ServiceForm service={original} existingGroups={[]} onSave={onSave} onClose={vi.fn()} baselineRevision="one" /></Routes>
    </UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("URL", { exact: true }), { target: { value: "https://host/edited" } });
    if (edited) {
      fireEvent.change(screen.getByLabelText("Name *"), { target: { value: expected.name } });
      fireEvent.change(screen.getByLabelText("Description"), { target: { value: expected.description } });
      fireEvent.change(screen.getByLabelText("Group"), { target: { value: expected.group } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Read recovery" }));
    expect(JSON.stringify(read.mock.calls[0][0])).not.toContain("fixture-");
    await traverse();
    await traverse();
    expect(screen.getByLabelText("Name *")).toHaveValue(expected.name);
    expect(screen.getByLabelText("Description")).toHaveValue(expected.description);
    expect(screen.getByLabelText("Group")).toHaveValue(expected.group);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining(expected)));
  });

  it.each([false, true])("preserves provenance for URL-shaped bookmark text fields (explicit edits: %s)", async (edited) => {
    const original = { ...bookmark, name: "https://name/value?view=fixture-name#name",
      placement: { group: "https://group/value?view=fixture-group#group" }, links: [{ ...bookmark.links[0],
        name: "https://link-name/value?view=fixture-link-name#name", description: "https://description/value?view=fixture-description#description", abbr: "AB" }] };
    const expected = edited ? { name: "https://name/value", group: "https://group/value", linkName: "https://link-name/value", description: "https://description/value" }
      : { name: original.name, group: original.placement.group, linkName: original.links[0].name, description: original.links[0].description };
    const onSave = vi.fn();
    const read = vi.fn();
    render(<UnsavedChangesProvider>
      <RecoveryProbe id={`dashboard:bookmark-form:${original.name}`} read={read} />
      <Routes><BookmarkGroupForm bookmark={original} knownGroups={[original.placement.group, "https://group/value"]} onSave={onSave} onClose={vi.fn()} baselineRevision="one" /></Routes>
    </UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Link 1 URL"), { target: { value: "https://host/edited" } });
    if (edited) {
      fireEvent.change(screen.getByLabelText("Name *"), { target: { value: expected.name } });
      fireEvent.change(screen.getByLabelText("Placement group"), { target: { value: expected.group } });
      fireEvent.change(screen.getByLabelText("Link 1 name"), { target: { value: expected.linkName } });
      fireEvent.change(screen.getByLabelText("Link 1 description"), { target: { value: expected.description } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Read recovery" }));
    expect(JSON.stringify(read.mock.calls[0][0])).not.toContain("fixture-");
    await traverse();
    await traverse();
    expect(screen.getByLabelText("Name *")).toHaveValue(expected.name);
    expect(screen.getByLabelText("Placement group")).toHaveValue(expected.group);
    expect(screen.getByLabelText("Link 1 name")).toHaveValue(expected.linkName);
    expect(screen.getByLabelText("Link 1 description")).toHaveValue(expected.description);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: expected.name,
      placement: expect.objectContaining({ group: expected.group }), links: [expect.objectContaining({ name: expected.linkName, description: expected.description, abbr: "AB" })] })));
  });

  it.each(["service", "bookmark"])("keeps recovered %s edits blocked when the server revision changed", async (kind) => {
    const onSave = vi.fn();
    render(<UnsavedChangesProvider><Routes>{kind === "service"
      ? <ServiceForm service={service} existingGroups={[]} onSave={onSave} onClose={vi.fn()} baselineRevision="one" />
      : <BookmarkGroupForm bookmark={bookmark} knownGroups={[]} onSave={onSave} onClose={vi.fn()} baselineRevision="one" />
    }</Routes></UnsavedChangesProvider>);
    fireEvent.change(screen.getByLabelText("Name *"), { target: { value: "Kept safe edit" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { headers: { "x-config-revision": "two" } })));
    await traverse();
    await waitFor(() => expect(screen.getByText(/Settings changed or could not be verified/)).toBeInTheDocument());
    expect(screen.getByLabelText("Name *")).toHaveValue("Kept safe edit");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.submit(screen.getByLabelText("Name *").closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
  });
});
