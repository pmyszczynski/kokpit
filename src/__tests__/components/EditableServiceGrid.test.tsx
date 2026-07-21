import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { KokpitConfigSchema, type KokpitConfig } from "@/config/schema";

// EditableServiceGrid reads the B1 setters from useEditMode; stub the context so
// the grid can render standalone (drag gestures aren't fired in jsdom — the
// reorder logic is covered by config/reorder.test.ts).
const setServices = vi.fn();
const setGroups = vi.fn();
const setBookmarks = vi.fn();
vi.mock("@/components/edit/EditModeProvider", () => ({
  useEditMode: () => ({ setServices, setGroups, setBookmarks }),
}));

import EditableServiceGrid from "@/components/edit/EditableServiceGrid";
import ServiceTile from "@/components/ServiceTile";
import CollapsibleGroup from "@/components/CollapsibleGroup";

function cfg(overrides: Record<string, unknown> = {}): KokpitConfig {
  return KokpitConfigSchema.parse({
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
