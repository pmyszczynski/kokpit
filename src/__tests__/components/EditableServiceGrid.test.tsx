import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, screen } from "@testing-library/react";
import type { KokpitConfig } from "@/config/schema";
import { migrateV1Config } from "@/config/loader";

// EditableServiceGrid reads the B1 setters from useEditMode; stub the context so
// the grid can render standalone (drag gestures aren't fired in jsdom — the
// reorder logic is covered by config/reorder.test.ts).
const setServices = vi.fn();
const setGroups = vi.fn();
const setBookmarks = vi.fn();
// Mutable so individual tests can seed a pending name before rendering — see
// the "pendingEditService" describe block below.
let pendingEditService: string | null = null;
const clearPendingEditService = vi.fn(() => {
  pendingEditService = null;
});
vi.mock("@/components/edit/EditModeProvider", () => ({
  useEditMode: () => ({
    setServices,
    setGroups,
    setBookmarks,
    pendingEditService,
    clearPendingEditService,
  }),
}));

import EditableServiceGrid from "@/components/edit/EditableServiceGrid";
import ServiceTile from "@/components/ServiceTile";
import CollapsibleGroup from "@/components/CollapsibleGroup";

function cfg(overrides: Record<string, unknown> = {}): KokpitConfig {
  return migrateV1Config({
    schema_version: 1,
    groups: [{ name: "Media" }],
    services: [
      { name: "Plex", url: "https://plex.local", group: "Media" },
      { name: "Loose", url: "https://loose.local" },
    ],
    bookmarks: [{ name: "Dev", links: [{ name: "GH", url: "https://github.com" }] }],
    ...overrides,
  });
}

describe("edit-mode drag handles", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders tile + group drag handles in the editable grid", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<EditableServiceGrid config={cfg()} />));
    });
    // A handle per tile (2 services + 1 bookmark).
    expect(container.querySelectorAll(".tile-drag-handle")).toHaveLength(3);
    // Declared "Media" group gets a reorder handle...
    expect(container.querySelectorAll(".group-drag-handle")).toHaveLength(1);
    // ...but tile roots keep their hard-constraint selectors.
    expect(container.querySelectorAll(".service-tile")).toHaveLength(2);
    expect(container.querySelector(".bookmark-tile")).not.toBeNull();
  });

  it("marks editable tiles without breaking the size preset classes", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <EditableServiceGrid
          config={cfg({
            services: [{ name: "Big", size: "large", group: "Media" }],
            bookmarks: undefined,
          })}
        />
      ));
    });
    const tile = container.querySelector(".service-tile");
    expect(tile?.classList.contains("service-tile--large")).toBe(true);
    expect(tile?.classList.contains("service-tile--editable")).toBe(true);
  });

  it("does not add a group handle to the implicit Bookmarks section", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <EditableServiceGrid
          config={cfg({
            groups: undefined,
            services: [],
            bookmarks: [
              { name: "Dev", links: [{ name: "GH", url: "https://github.com" }] },
            ],
          })}
        />
      ));
    });
    // Implicit "Bookmarks" section renders but is pinned — no reorder handle.
    expect(container.querySelector(".service-group__header")).not.toBeNull();
    expect(container.querySelector(".group-drag-handle")).toBeNull();
  });
});

// jsdom doesn't implement <dialog>'s showModal/close at all (neither method
// exists on the prototype), so there's nothing for vi.spyOn to wrap until a
// base implementation is installed once, here. Each test then spies on top
// of this stub and vi.restoreAllMocks() reverts to it — unlike a direct
// `HTMLDialogElement.prototype.showModal = vi.fn()` assignment, which
// vi.clearAllMocks() (see afterEach below) does NOT undo, leaking the
// patched prototype methods into later suites in this file.
if (typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function () {};
}
if (typeof HTMLDialogElement.prototype.close !== "function") {
  HTMLDialogElement.prototype.close = function () {};
}

describe("pendingEditService (broken-widget badge → ServiceForm handoff)", () => {
  let showModalSpy: ReturnType<typeof vi.spyOn>;
  let closeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    showModalSpy = vi
      .spyOn(HTMLDialogElement.prototype, "showModal")
      .mockImplementation(() => {});
    closeSpy = vi
      .spyOn(HTMLDialogElement.prototype, "close")
      .mockImplementation(function (this: HTMLDialogElement) {
        this.dispatchEvent(new Event("close"));
      });
  });

  afterEach(() => {
    // Clears call history for every mock in the file (module-scope
    // setServices/setGroups/setBookmarks/clearPendingEditService included),
    // same as before. mockRestore() on the two dialog spies additionally
    // reverts HTMLDialogElement.prototype back to the plain stub installed
    // above, so the next beforeEach spies on that stub fresh instead of
    // stacking a spy on top of the previous test's spy.
    vi.clearAllMocks();
    showModalSpy.mockRestore();
    closeSpy.mockRestore();
    pendingEditService = null;
  });

  it("a pendingEditService naming a real service opens its ServiceForm dialog, then clears the pending name", async () => {
    pendingEditService = "Plex";
    await act(async () => {
      render(<EditableServiceGrid config={cfg()} />);
    });
    expect(screen.getByText("Edit Service")).toBeInTheDocument();
    const nameInput = screen.getByLabelText("Name *") as HTMLInputElement;
    expect(nameInput.value).toBe("Plex");
    expect(clearPendingEditService).toHaveBeenCalledTimes(1);
  });

  it("a pendingEditService naming no service just clears the pending name (no dialog)", async () => {
    pendingEditService = "No Such Service";
    await act(async () => {
      render(<EditableServiceGrid config={cfg()} />);
    });
    expect(screen.queryByText("Edit Service")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(clearPendingEditService).toHaveBeenCalledTimes(1);
  });

  it("a null pendingEditService is left alone (no dialog, no clear)", async () => {
    pendingEditService = null;
    await act(async () => {
      render(<EditableServiceGrid config={cfg()} />);
    });
    expect(screen.queryByText("Edit Service")).not.toBeInTheDocument();
    expect(clearPendingEditService).not.toHaveBeenCalled();
  });
});

describe("view mode is unchanged (no drag chrome)", () => {
  it("ServiceTile without drag props renders no handle", () => {
    const { container } = render(<ServiceTile name="Plex" url="https://plex.local" />);
    expect(container.querySelector(".tile-drag-handle")).toBeNull();
    expect(container.querySelector(".service-tile--editable")).toBeNull();
    // Root element + class preserved.
    expect(container.querySelector("a.service-tile")).not.toBeNull();
  });

  it("CollapsibleGroup without drag props renders no group handle", () => {
    const { container } = render(
      <CollapsibleGroup name="Media">
        <div>child</div>
      </CollapsibleGroup>
    );
    expect(container.querySelector(".group-drag-handle")).toBeNull();
    expect(container.querySelector(".service-group__toggle")).not.toBeNull();
  });
});
