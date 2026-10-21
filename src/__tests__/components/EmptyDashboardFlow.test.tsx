import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KokpitConfigSchema, type Service } from "@/config/schema";
import EmptyDashboard from "@/components/EmptyDashboard";
import DashboardSurface from "@/components/edit/DashboardSurface";
import { EditModeProvider, editModeReducer, initialEditModeState } from "@/components/edit/EditModeProvider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ServiceForm", () => ({
  default: ({ initialPreset, onSave, onClose }: { initialPreset?: string; onSave: (service: Service) => void; onClose: () => void }) => (
    <section role="dialog" aria-label="Add Service">
      <span data-testid="preset">{initialPreset ?? "blank"}</span>
      <button onClick={() => onSave({ name: "New service", url: "https://new.example" })}>Stage service</button>
      <button onClick={onClose}>Cancel service</button>
    </section>
  ),
}));
vi.mock("@/components/BookmarkGroupForm", () => ({
  default: ({ onSave, onClose }: { onSave: (bookmark: { name: string; links: Array<{ name: string; url: string }> }) => void; onClose: () => void }) => (
    <section role="dialog" aria-label="Add Bookmark Group">
      <button onClick={() => onSave({ name: "Links", links: [{ name: "Docs", url: "https://docs.example" }] })}>Stage bookmark</button>
      <button onClick={onClose}>Cancel bookmark</button>
    </section>
  ),
}));

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
}
if (!HTMLDialogElement.prototype.close) {
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
}

function configuration(hasCatalog = false) {
  return KokpitConfigSchema.parse({
    schema_version: 2, services: hasCatalog ? [{ id: "10000000-0000-4000-8000-000000000001", name: "Saved only", launch_url: "https://saved.example" }] : [],
    service_tiles: [], bookmarks: [],
  });
}
function app(hasCatalog = false, canEdit = true) {
  return <EditModeProvider canEdit={canEdit} connectionTestingEnabled={false}><DashboardSurface><EmptyDashboard hasSavedServices={hasCatalog} /></DashboardSurface></EditModeProvider>;
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "X-Config-Revision": "revision" } });
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("empty dashboard staged add flow", () => {
  it("preserves one pending request through entry and clears it on failure/discard", () => {
    const requested = editModeReducer(initialEditModeState, { type: "REQUEST_TILE_ADD", kind: "service" });
    const repeated = editModeReducer(requested, { type: "REQUEST_TILE_ADD", kind: "picker" });
    expect(repeated.pendingAddTile).toBe("service");
    const entered = editModeReducer(repeated, { type: "ENTER_SUCCESS", config: configuration(), revision: "revision" });
    expect(entered.pendingAddTile).toBe("service");
    expect(editModeReducer(entered, { type: "ENTER_ERROR", error: "entry failed" }).pendingAddTile).toBeNull();
    expect(editModeReducer(entered, { type: "DISCARD" }).pendingAddTile).toBeNull();
  });

  it("deduplicates rapid activation and does not reopen a cancelled form on rerender", async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(app());
    const button = screen.getByRole("button", { name: "Add your first service" });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Opening editor…" })).toBeDisabled();
    await act(async () => { resolve(response(configuration())); });
    expect(screen.getAllByRole("dialog", { name: "Add Service" })).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancel service" })); });
    view.rerender(app());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save & exit" })); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("clears failed entry, exposes retry, and opens once after recovery", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response(configuration()));
    vi.stubGlobal("fetch", fetchMock); render(app());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add your first service" })); });
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load settings (503)");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add your first service" })); });
    expect(screen.getAllByRole("dialog", { name: "Add Service" })).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["Blank service", "Plex", "Bookmark group"])("uses the existing picker choice %s without writing on open or cancel", async choice => {
    const fetchMock = vi.fn().mockResolvedValue(response(configuration())); vi.stubGlobal("fetch", fetchMock);
    render(app());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "More tile options" })); });
    expect(screen.getByRole("dialog", { name: "Add tile" })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: choice === "Plex" ? "Plex" : new RegExp(choice) })); });
    expect(screen.getByRole("dialog", { name: choice === "Bookmark group" ? "Add Bookmark Group" : "Add Service" })).toBeInTheDocument();
    if (choice === "Plex") expect(screen.getByTestId("preset")).toHaveTextContent("plex");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: choice === "Bookmark group" ? "Cancel bookmark" : "Cancel service" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Discard" })); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves unplaced catalog records and stages a new service until explicit save", async () => {
    const config = configuration(true);
    const fetchMock = vi.fn().mockImplementation((url: string, _init?: RequestInit) => {
      if (url === "/api/settings") return Promise.resolve(response(config));
      return Promise.resolve(response({ ok: true }));
    });
    vi.stubGlobal("fetch", fetchMock); render(app(true));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add a tile" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Blank service/ })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Stage service" })); });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save & exit" })); });
    const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patches).toHaveLength(1);
    const body = JSON.parse(patches[0][1]!.body as string);
    expect(body.services).toContainEqual(config.services[0]);
    expect(body.services).toHaveLength(2);
    expect(body.service_tiles).toHaveLength(1);
  });

  it("stages bookmark creation and discards it without a settings write", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(configuration())); vi.stubGlobal("fetch", fetchMock);
    render(app());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "More tile options" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Bookmark group/ })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Stage bookmark" })); });
    expect(screen.getByRole("region", { name: "Edit mode" })).toHaveTextContent("unsaved change");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Discard" })); });
    expect(screen.getByRole("button", { name: "Add your first service" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows no editor action or fetch for a read-only viewer", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); render(app(false, false));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
