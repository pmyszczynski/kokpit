import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { KokpitConfigSchema, type KokpitConfig } from "@/config/schema";

// Stub the B1 context so the grid renders standalone; the setters ARE the
// staging surface, so asserting they were called with the mutated arrays proves
// the kebab/add actions stage into the draft.
const setServices = vi.fn();
const setGroups = vi.fn();
const setBookmarks = vi.fn();
const updateDraft = vi.fn();
vi.mock("@/components/edit/EditModeProvider", () => ({
  useEditMode: () => ({ setServices, setGroups, setBookmarks, updateDraft }),
}));

import "@/integrations";
import EditableServiceGrid from "@/components/edit/EditableServiceGrid";

function cfg(overrides: Record<string, unknown> = {}): KokpitConfig {
  return KokpitConfigSchema.parse({
    schema_version: 1,
    groups: [{ name: "Media" }],
    services: [{ name: "Plex", url: "https://plex.local", group: "Media" }],
    bookmarks: [
      {
        name: "Dev",
        links: [{ name: "GH", url: "https://github.com" }],
        placement: { group: "Media" },
      },
    ],
    ...overrides,
  });
}

async function renderGrid(config: KokpitConfig) {
  let container!: HTMLElement;
  await act(async () => {
    ({ container } = render(<EditableServiceGrid config={config} />));
  });
  return container;
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn().mockImplementation(function (
    this: HTMLDialogElement
  ) {
    this.dispatchEvent(new Event("close"));
  });
});

afterEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("service tile kebab", () => {
  it("opens ServiceForm on Edit and stages the update via setServices", async () => {
    await renderGrid(cfg());
    fireEvent.click(screen.getByRole("button", { name: "Plex options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));

    // The existing ServiceForm dialog is now mounted against the draft.
    expect(screen.getByText("Edit Service")).toBeInTheDocument();
    const nameInput = screen.getByLabelText("Name *") as HTMLInputElement;
    expect(nameInput.value).toBe("Plex");
    fireEvent.change(nameInput, { target: { value: "Plex HD" } });
    fireEvent.submit(nameInput.closest("form")!);

    expect(setServices).toHaveBeenCalledTimes(1);
    const next = setServices.mock.calls[0][0];
    expect(next.map((s: { name: string }) => s.name)).toEqual(["Plex HD"]);
    expect(next[0].group).toBe("Media");
  });

  it("moves focus to the first menu item on open", async () => {
    await renderGrid(cfg());
    fireEvent.click(screen.getByRole("button", { name: "Plex options" }));
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Edit" })
    );
  });

  it("Duplicate stages a copy after the original", async () => {
    await renderGrid(cfg());
    fireEvent.click(screen.getByRole("button", { name: "Plex options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(setServices).toHaveBeenCalledTimes(1);
    expect(
      setServices.mock.calls[0][0].map((s: { name: string }) => s.name)
    ).toEqual(["Plex", "Plex copy"]);
  });

  it("Remove stages a delete after confirmation", async () => {
    await renderGrid(cfg());
    fireEvent.click(screen.getByRole("button", { name: "Plex options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    // Two-step confirm.
    expect(setServices).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Confirm remove" }));
    expect(setServices).toHaveBeenCalledWith([]);
  });

  it("size picker greys out sizes below the widget minSize", async () => {
    await renderGrid(
      cfg({
        services: [
          { name: "Sonarr", widget: { type: "sonarr-queue" }, group: "Media" },
        ],
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Sonarr options" }));
    // sonarr-queue has minSize "tall" → normal + wide disabled, tall/large ok.
    expect(
      (screen.getByRole("button", { name: "Normal (1×1)" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Wide (2×1)" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Tall (1×2)" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it("applying a size stages it via setServices", async () => {
    await renderGrid(cfg());
    fireEvent.click(screen.getByRole("button", { name: "Plex options" }));
    fireEvent.click(screen.getByRole("button", { name: "Wide (2×1)" }));
    expect(setServices).toHaveBeenCalledTimes(1);
    expect(setServices.mock.calls[0][0][0].size).toBe("wide");
  });
});

describe("bookmark tile kebab", () => {
  it("opens BookmarkGroupForm on Edit and stages via setBookmarks", async () => {
    await renderGrid(cfg());
    fireEvent.click(screen.getByRole("button", { name: "Dev options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(screen.getByText("Edit Bookmark Group")).toBeInTheDocument();
    const nameInput = screen.getByLabelText("Name *") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Developer" } });
    fireEvent.submit(nameInput.closest("form")!);
    expect(setBookmarks).toHaveBeenCalledTimes(1);
    expect(setBookmarks.mock.calls[0][0][0].name).toBe("Developer");
  });

  it("Duplicate stages a bookmark copy", async () => {
    await renderGrid(cfg());
    fireEvent.click(screen.getByRole("button", { name: "Dev options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(
      setBookmarks.mock.calls[0][0].map((b: { name: string }) => b.name)
    ).toEqual(["Dev", "Dev copy"]);
  });
});

describe("add flow", () => {
  it("adds a blank service into the group it was launched from", async () => {
    await renderGrid(cfg());
    // The Media section's ghost tile.
    fireEvent.click(screen.getByRole("button", { name: "Add tile to Media" }));
    // Picker options live in a <dialog> (showModal mocked) — query by text.
    fireEvent.click(screen.getByText("Blank service"));

    // Blank ServiceForm with the group prefilled.
    expect(screen.getByText("Add Service")).toBeInTheDocument();
    const nameInput = screen.getByLabelText("Name *") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Overseerr" } });
    fireEvent.submit(nameInput.closest("form")!);

    expect(setServices).toHaveBeenCalledTimes(1);
    const next = setServices.mock.calls[0][0];
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ name: "Overseerr", group: "Media" });
  });

  it("a widget preset pre-fills the service form", async () => {
    await renderGrid(cfg());
    fireEvent.click(screen.getByRole("button", { name: "Add tile to Media" }));
    // Pick any preset integration (picker lives in a mocked <dialog>).
    fireEvent.click(screen.getByText("Sonarr Queue"));
    expect(screen.getByText("Add Service")).toBeInTheDocument();
    const tileType = screen.getByLabelText("Tile type") as HTMLSelectElement;
    expect(tileType.value).toBe("sonarr-queue");
  });

  it("respects the form when the user clears the prefilled group", async () => {
    await renderGrid(cfg());
    fireEvent.click(screen.getByRole("button", { name: "Add tile to Media" }));
    fireEvent.click(screen.getByText("Blank service"));

    // Group is prefilled to the launch section, then cleared by the user.
    const groupInput = screen.getByLabelText("Group") as HTMLInputElement;
    expect(groupInput.value).toBe("Media");
    fireEvent.change(groupInput, { target: { value: "" } });

    const nameInput = screen.getByLabelText("Name *") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Overseerr" } });
    fireEvent.submit(nameInput.closest("form")!);

    const next = setServices.mock.calls[0][0];
    // Ungrouped — NOT forced back into the launch group "Media".
    expect(next[1].name).toBe("Overseerr");
    expect(next[1].group).toBeUndefined();
  });
});

describe("group kebab", () => {
  it("rename cascades to services + bookmarks and migrates the collapse key", async () => {
    window.localStorage.setItem("kokpit.group-collapsed:Media", "true");
    await renderGrid(cfg());
    fireEvent.click(screen.getByRole("button", { name: "Media group options" }));
    const input = screen.getByLabelText("Rename group Media") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Streaming" } });
    const field = input.closest(".kebab-menu__field") as HTMLElement;
    fireEvent.click(within(field).getByRole("button", { name: "Apply" }));

    expect(updateDraft).toHaveBeenCalledTimes(1);
    const patch = updateDraft.mock.calls[0][0];
    expect(patch.groups.map((g: { name: string }) => g.name)).toEqual([
      "Streaming",
    ]);
    expect(patch.services[0].group).toBe("Streaming");
    expect(patch.bookmarks[0].placement.group).toBe("Streaming");

    // Collapse preference migrated to the new key.
    expect(window.localStorage.getItem("kokpit.group-collapsed:Media")).toBeNull();
    expect(
      window.localStorage.getItem("kokpit.group-collapsed:Streaming")
    ).toBe("true");
  });

  it("rejects a rename that collides with another declared group", async () => {
    await renderGrid(
      cfg({ groups: [{ name: "Media" }, { name: "Infra" }] })
    );
    fireEvent.click(screen.getByRole("button", { name: "Media group options" }));
    const input = screen.getByLabelText("Rename group Media") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Infra" } });
    const field = input.closest(".kebab-menu__field") as HTMLElement;
    fireEvent.click(within(field).getByRole("button", { name: "Apply" }));
    expect(updateDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/already exists/);
  });

  it("declares an undeclared group via setGroups", async () => {
    await renderGrid(
      cfg({
        groups: undefined,
        services: [{ name: "Plex", url: "https://plex.local", group: "Media" }],
        bookmarks: undefined,
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Media group options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Declare group" }));
    expect(setGroups).toHaveBeenCalledWith([{ name: "Media" }]);
  });

  it("deletes a declared group via updateDraft after confirmation", async () => {
    await renderGrid(cfg());
    fireEvent.click(screen.getByRole("button", { name: "Media group options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete group" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Confirm remove" }));
    expect(updateDraft).toHaveBeenCalledTimes(1);
    const patch = updateDraft.mock.calls[0][0];
    expect(patch.groups).toEqual([]);
    expect(patch.services[0].group).toBeUndefined();
  });
});
