import { describe, it, expect } from "vitest";
import {
  moveServiceToGroup,
  moveBookmarkToGroup,
  reorderGroups,
  serviceTileId,
  bookmarkTileId,
  groupSortableId,
  groupContainerId,
} from "@/config/reorder";
import type { BookmarkGroup, Group, Service } from "@/config/schema";

function svc(name: string, group?: string, extra: Partial<Service> = {}): Service {
  return { name, ...(group ? { group } : {}), ...extra };
}
function names(services: Service[]): string[] {
  return services.map((s) => s.name);
}
function groupOf(services: Service[], name: string): string | undefined {
  return services.find((s) => s.name === name)?.group;
}

function bm(
  name: string,
  group?: string,
  extra: Partial<BookmarkGroup> = {}
): BookmarkGroup {
  return {
    name,
    links: [{ name: "L", url: "https://example.com" }],
    ...(group ? { placement: { group } } : {}),
    ...extra,
  };
}

describe("id helpers", () => {
  it("prefix tile + container ids and normalize group keys", () => {
    expect(serviceTileId("Plex")).toBe("service:Plex");
    expect(bookmarkTileId("Dev")).toBe("bookmark:Dev");
    // Group ids are case-insensitively normalized.
    expect(groupSortableId("Media")).toBe(groupSortableId("media"));
    expect(groupContainerId("Media")).toBe("container:media");
  });
});

describe("moveServiceToGroup — within-group reorder", () => {
  const media = [svc("A", "Media"), svc("B", "Media"), svc("C", "Media"), svc("D", "Media")];

  it("moves an item to the middle", () => {
    expect(names(moveServiceToGroup(media, "A", "Media", 2))).toEqual([
      "B",
      "C",
      "A",
      "D",
    ]);
  });

  it("moves an item to the first position", () => {
    expect(names(moveServiceToGroup(media, "C", "Media", 0))).toEqual([
      "C",
      "A",
      "B",
      "D",
    ]);
  });

  it("moves an item to the last position", () => {
    expect(names(moveServiceToGroup(media, "A", "Media", 3))).toEqual([
      "B",
      "C",
      "D",
      "A",
    ]);
  });

  it("clamps an out-of-range target index to the end", () => {
    expect(names(moveServiceToGroup(media, "A", "Media", 99))).toEqual([
      "B",
      "C",
      "D",
      "A",
    ]);
  });

  it("is a stable no-op when moved to its own slot", () => {
    expect(names(moveServiceToGroup(media, "B", "Media", 1))).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it("keeps other groups' services in their relative positions", () => {
    const mixed = [
      svc("A", "Media"),
      svc("X", "Downloads"),
      svc("B", "Media"),
      svc("Y", "Downloads"),
      svc("C", "Media"),
    ];
    const next = moveServiceToGroup(mixed, "A", "Media", 2);
    // Media order becomes B, C, A; Downloads X/Y untouched relative order.
    expect(names(next.filter((s) => s.group === "Media"))).toEqual([
      "B",
      "C",
      "A",
    ]);
    expect(names(next.filter((s) => s.group === "Downloads"))).toEqual([
      "X",
      "Y",
    ]);
  });

  it("preserves the moved service's widget config and other fields", () => {
    const withWidget = [
      svc("A", "Media", {
        url: "http://a.local",
        widget: { type: "plex", config: { url: "http://a", token: "t" } },
      }),
      svc("B", "Media"),
    ];
    const moved = moveServiceToGroup(withWidget, "A", "Media", 1).find(
      (s) => s.name === "A"
    )!;
    expect(moved.widget).toEqual({
      type: "plex",
      config: { url: "http://a", token: "t" },
    });
    expect(moved.url).toBe("http://a.local");
  });
});

describe("moveServiceToGroup — cross-group + ungrouped", () => {
  it("moves a service into another declared group at an index", () => {
    const services = [svc("A", "G1"), svc("X", "G2"), svc("B", "G1")];
    const next = moveServiceToGroup(services, "A", "G2", 0);
    expect(groupOf(next, "A")).toBe("G2");
    expect(names(next.filter((s) => s.group === "G2"))).toEqual(["A", "X"]);
    expect(names(next.filter((s) => s.group === "G1"))).toEqual(["B"]);
  });

  it("appends to the target group when index is at/after the end", () => {
    const services = [svc("A", "G1"), svc("X", "G2")];
    const next = moveServiceToGroup(services, "A", "G2", 1);
    expect(names(next.filter((s) => s.group === "G2"))).toEqual(["X", "A"]);
  });

  it("dropping into ungrouped (null) clears the group field", () => {
    const services = [svc("A", "Media"), svc("B", "Media")];
    const next = moveServiceToGroup(services, "A", null, 0);
    expect(groupOf(next, "A")).toBeUndefined();
    expect("group" in next.find((s) => s.name === "A")!).toBe(false);
  });

  it("moves an ungrouped service into a group", () => {
    const services = [svc("Loose"), svc("A", "Media")];
    const next = moveServiceToGroup(services, "Loose", "Media", 0);
    expect(groupOf(next, "Loose")).toBe("Media");
    expect(names(next.filter((s) => s.group === "Media"))).toEqual([
      "Loose",
      "A",
    ]);
  });

  it("moves into a declared-but-empty group", () => {
    const services = [svc("A", "Media")];
    const next = moveServiceToGroup(services, "A", "Empty", 0);
    expect(groupOf(next, "A")).toBe("Empty");
  });

  it("handles single-item source groups", () => {
    const services = [svc("Solo", "G1"), svc("X", "G2")];
    const next = moveServiceToGroup(services, "Solo", "G2", 1);
    expect(groupOf(next, "Solo")).toBe("G2");
    expect(names(next.filter((s) => s.group === "G2"))).toEqual(["X", "Solo"]);
  });

  it("returns the same array reference for an unknown service", () => {
    const services = [svc("A", "Media")];
    expect(moveServiceToGroup(services, "Nope", "Media", 0)).toBe(services);
  });

  it("matches names case-insensitively", () => {
    const services = [svc("Plex", "Media"), svc("B", "Media")];
    const next = moveServiceToGroup(services, "plex", "Media", 1);
    expect(names(next.filter((s) => s.group === "Media"))).toEqual(["B", "Plex"]);
  });
});

describe("moveBookmarkToGroup", () => {
  it("reorders bookmark tiles within a group", () => {
    const bms = [bm("A", "Media"), bm("B", "Media"), bm("C", "Media")];
    const next = moveBookmarkToGroup(bms, "A", "Media", 2);
    expect(next.map((b) => b.name)).toEqual(["B", "C", "A"]);
  });

  it("updates placement.group on a cross-group move", () => {
    const bms = [bm("A", "G1"), bm("X", "G2")];
    const next = moveBookmarkToGroup(bms, "A", "G2", 0);
    expect(next.find((b) => b.name === "A")!.placement?.group).toBe("G2");
  });

  it("dropping into ungrouped clears placement.group (drops emptied placement)", () => {
    const bms = [bm("A", "Media"), bm("B", "Media")];
    const moved = moveBookmarkToGroup(bms, "A", null, 0).find(
      (b) => b.name === "A"
    )!;
    expect(moved.placement).toBeUndefined();
  });

  it("clears placement.group but preserves placement.size", () => {
    const bms: BookmarkGroup[] = [
      {
        name: "A",
        links: [{ name: "L", url: "https://example.com" }],
        placement: { group: "Media", size: "large" },
      },
    ];
    const moved = moveBookmarkToGroup(bms, "A", null, 0).find(
      (b) => b.name === "A"
    )!;
    expect(moved.placement).toEqual({ size: "large" });
  });

  it("preserves links, accent and style", () => {
    const bms: BookmarkGroup[] = [
      {
        name: "A",
        accent: "#7aa2f7",
        style: "icon-grid",
        links: [{ name: "GH", url: "https://github.com" }],
        placement: { group: "G1" },
      },
    ];
    const moved = moveBookmarkToGroup(bms, "A", "G2", 0).find(
      (b) => b.name === "A"
    )!;
    expect(moved.accent).toBe("#7aa2f7");
    expect(moved.style).toBe("icon-grid");
    expect(moved.links).toEqual([{ name: "GH", url: "https://github.com" }]);
    expect(moved.placement?.group).toBe("G2");
  });

  it("moves a loose bookmark into a group", () => {
    const bms = [bm("Loose"), bm("A", "Media")];
    const next = moveBookmarkToGroup(bms, "Loose", "Media", 0);
    expect(next.find((b) => b.name === "Loose")!.placement?.group).toBe("Media");
  });

  it("returns the same array reference for an unknown bookmark", () => {
    const bms = [bm("A", "Media")];
    expect(moveBookmarkToGroup(bms, "Nope", "Media", 0)).toBe(bms);
  });
});

describe("reorderGroups", () => {
  const groups: Group[] = [{ name: "Media" }, { name: "Downloads" }, { name: "Infra" }];

  it("moves a group from first to last", () => {
    expect(reorderGroups(groups, "Media", "Infra").map((g) => g.name)).toEqual([
      "Downloads",
      "Infra",
      "Media",
    ]);
  });

  it("moves a group from last to first", () => {
    expect(reorderGroups(groups, "Infra", "Media").map((g) => g.name)).toEqual([
      "Infra",
      "Media",
      "Downloads",
    ]);
  });

  it("preserves group objects intact (columns/collapsed)", () => {
    const rich: Group[] = [
      { name: "Media", columns: 6, collapsed: true },
      { name: "Downloads" },
    ];
    const next = reorderGroups(rich, "Downloads", "Media");
    expect(next[1]).toEqual({ name: "Media", columns: 6, collapsed: true });
  });

  it("is a no-op for active === over", () => {
    expect(reorderGroups(groups, "Media", "Media")).toBe(groups);
  });

  it("is a no-op for an unknown group name", () => {
    expect(reorderGroups(groups, "Nope", "Media")).toBe(groups);
  });

  it("matches names case-insensitively", () => {
    expect(reorderGroups(groups, "media", "infra").map((g) => g.name)).toEqual([
      "Downloads",
      "Infra",
      "Media",
    ]);
  });
});
