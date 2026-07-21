import { describe, it, expect } from "vitest";
import {
  uniqueCopyName,
  duplicateService,
  duplicateBookmark,
} from "@/config/duplicate";
import {
  applyGroupCascades,
  renameGroupPatch,
  deleteGroupPatch,
  declareGroup,
  setGroupColumns,
} from "@/config/groupCascade";
import type { BookmarkGroup, Group, Service } from "@/config/schema";

describe("uniqueCopyName", () => {
  it("appends ' copy' when free", () => {
    expect(uniqueCopyName("Plex", ["Plex"])).toBe("Plex copy");
  });

  it("numbers subsequent copies, respecting the uniqueness key", () => {
    expect(uniqueCopyName("Plex", ["Plex", "plex COPY"])).toBe("Plex copy 2");
    expect(
      uniqueCopyName("Plex", ["Plex", "Plex copy", "Plex copy 2"])
    ).toBe("Plex copy 3");
  });
});

describe("duplicateService", () => {
  const services: Service[] = [
    { name: "Plex", url: "https://plex.local", group: "Media", size: "large" },
    { name: "Radarr", url: "https://radarr.local" },
  ];

  it("inserts a uniquely-named clone right after the original", () => {
    const next = duplicateService(services, "Plex");
    expect(next.map((s) => s.name)).toEqual(["Plex", "Plex copy", "Radarr"]);
    expect(next[1]).toMatchObject({ group: "Media", size: "large" });
    // Original untouched, clone is a distinct object.
    expect(next[0]).toBe(services[0]);
    expect(next[1]).not.toBe(services[0]);
  });

  it("clones nested widget config as a fresh object", () => {
    const withWidget: Service[] = [
      { name: "Plex", widget: { type: "plex", config: { url: "x" } } },
    ];
    const next = duplicateService(withWidget, "Plex");
    expect(next[1].widget).not.toBe(withWidget[0].widget);
    // Nested config is a distinct object (not shared by reference).
    expect(next[1].widget?.config).not.toBe(withWidget[0].widget?.config);
    expect(next[1].widget?.config).toEqual({ url: "x" });
    expect(next[1].widget?.type).toBe("plex");
  });

  it("deep-clones widget fields array", () => {
    const withFields: Service[] = [
      { name: "Plex", widget: { type: "plex", fields: ["a", "b"] } },
    ];
    const next = duplicateService(withFields, "Plex");
    expect(next[1].widget?.fields).not.toBe(withFields[0].widget?.fields);
    expect(next[1].widget?.fields).toEqual(["a", "b"]);
  });

  it("no-ops on an unknown name", () => {
    expect(duplicateService(services, "Nope")).toBe(services);
  });
});

describe("duplicateBookmark", () => {
  const bookmarks: BookmarkGroup[] = [
    {
      name: "Dev",
      links: [{ name: "GH", url: "https://github.com" }],
      placement: { group: "Infra", size: "tall" },
    },
  ];

  it("inserts a clone with fresh links + placement", () => {
    const next = duplicateBookmark(bookmarks, "Dev");
    expect(next.map((b) => b.name)).toEqual(["Dev", "Dev copy"]);
    expect(next[1].placement).toMatchObject({ group: "Infra", size: "tall" });
    expect(next[1].placement).not.toBe(bookmarks[0].placement);
    expect(next[1].links[0]).not.toBe(bookmarks[0].links[0]);
  });
});

describe("applyGroupCascades", () => {
  const services: Service[] = [
    { name: "Plex", group: "Media" },
    { name: "Radarr", group: "media" },
    { name: "Grafana", group: "Infra" },
  ];
  const bookmarks: BookmarkGroup[] = [
    { name: "Dev", links: [], placement: { group: "Media", size: "tall" } },
    { name: "Docs", links: [], placement: { group: "Infra" } },
  ];

  it("renames every case-insensitive reference", () => {
    const out = applyGroupCascades(services, bookmarks, [
      { type: "rename", from: "Media", to: "Streaming" },
    ]);
    expect(out.servicesChanged).toBe(true);
    expect(out.bookmarksChanged).toBe(true);
    expect(out.services.map((s) => s.group)).toEqual([
      "Streaming",
      "Streaming",
      "Infra",
    ]);
    expect(out.bookmarks[0].placement).toEqual({
      group: "Streaming",
      size: "tall",
    });
  });

  it("delete clears references, dropping an emptied placement", () => {
    const out = applyGroupCascades(services, bookmarks, [
      { type: "delete", name: "Infra" },
    ]);
    expect(out.services[2].group).toBeUndefined();
    // Docs' placement only had group → drops entirely.
    expect(out.bookmarks[1].placement).toBeUndefined();
    // Dev's placement kept its size.
    expect(out.bookmarks[0].placement).toEqual({ group: "Media", size: "tall" });
  });
});

describe("renameGroupPatch / deleteGroupPatch (minimal patches)", () => {
  const groups: Group[] = [{ name: "Media" }, { name: "Infra" }];
  const services: Service[] = [{ name: "Plex", group: "Media" }];
  const bookmarks: BookmarkGroup[] = [
    { name: "Dev", links: [], placement: { group: "Media" } },
  ];

  it("rename patches groups + services + bookmarks together", () => {
    const patch = renameGroupPatch(
      { groups, services, bookmarks },
      "Media",
      "Streaming"
    );
    expect(patch.groups?.map((g) => g.name)).toEqual(["Streaming", "Infra"]);
    expect(patch.services?.[0].group).toBe("Streaming");
    expect(patch.bookmarks?.[0].placement?.group).toBe("Streaming");
  });

  it("rename of an undeclared group omits the groups key", () => {
    const patch = renameGroupPatch(
      { groups: [], services, bookmarks },
      "Media",
      "Streaming"
    );
    expect(patch.groups).toBeUndefined();
    expect(patch.services?.[0].group).toBe("Streaming");
  });

  it("delete patches the groups drop + cascade clears", () => {
    const patch = deleteGroupPatch({ groups, services, bookmarks }, "Media");
    expect(patch.groups?.map((g) => g.name)).toEqual(["Infra"]);
    expect(patch.services?.[0].group).toBeUndefined();
    expect(patch.bookmarks?.[0].placement).toBeUndefined();
  });
});

describe("declareGroup / setGroupColumns", () => {
  it("declare appends an undeclared group, no-ops on a declared one", () => {
    const groups: Group[] = [{ name: "Media" }];
    expect(declareGroup(groups, "Infra").map((g) => g.name)).toEqual([
      "Media",
      "Infra",
    ]);
    expect(declareGroup(groups, "media")).toBe(groups);
    expect(declareGroup(groups, "  ")).toBe(groups);
  });

  it("setGroupColumns clamps to [1,12] and clears with undefined", () => {
    const groups: Group[] = [{ name: "Media", columns: 3 }];
    expect(setGroupColumns(groups, "Media", 20)[0].columns).toBe(12);
    expect(setGroupColumns(groups, "Media", undefined)[0].columns).toBeUndefined();
    expect(setGroupColumns(groups, "Media", 0)[0].columns).toBeUndefined();
    expect(setGroupColumns(groups, "Media", 4)[0].columns).toBe(4);
  });
});
