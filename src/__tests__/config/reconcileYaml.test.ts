// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import { reconcileSettingsDocument, UnsupportedYamlUpdateError } from "@/config/reconcileYaml";

function reconcile(source: string, updates: Record<string, unknown>) {
  const document = parseDocument(source);
  const result = reconcileSettingsDocument(document, updates);
  return { source: result, document: parseDocument(result) };
}

function itemComment(source: string, section: string, id: string): string {
  const node = parseDocument(source).get(section, true);
  if (!isSeq(node)) throw new Error("Expected sequence");
  const item = node.items.find((entry) => isMap(entry) && entry.get("id") === id);
  if (!isMap(item)) throw new Error("Expected item");
  const key = item.items.find((pair) => isScalar(pair.key) && pair.key.value === "id")?.key;
  return `${item.commentBefore ?? ""}${isScalar(key) ? key.commentBefore ?? "" : ""}${item.get("name", true)?.comment ?? ""}`;
}

describe("reconcileSettingsDocument", () => {
  it("keeps nested field comments, surviving key order, styles, and untouched extensions", () => {
    const result = reconcile(`# document
appearance:
  # theme meaning
  "theme": 'dark' # theme inline
  # keep sibling
  custom_css: |
    .tile { color: red; }
  # remove background
  background:
    color: black # delete color
extension: { retained: yes } # extension annotation
`, { appearance: { theme: "light", custom_css: ".tile { color: blue; }\n", card_blur: 4 } });
    expect(result.source).toContain("# document");
    expect(result.source).toContain('# theme meaning\n  "theme": \'light\' # theme inline');
    expect(result.source).toContain("# keep sibling");
    expect(result.source).toContain("custom_css: |");
    expect(result.source).toContain("extension: { retained: yes } # extension annotation");
    expect(result.source).not.toContain("remove background");
    expect(result.source).not.toContain("delete color");
    expect(Object.keys(result.document.toJS().appearance)).toEqual(["theme", "custom_css", "card_blur"]);
    expect(result.document.toJS().appearance.background).toBeUndefined();
  });

  it("moves services by ID, retains rename ownership, and drops removed credentials' annotations", () => {
    const source = `services:
  - # owner A
    id: a
    name: Old A # name A
    integration:
      type: demo
      config:
        api_key: synthetic # deleted credential
  - # owner B
    id: b
    name: B # name B
  - # removed C
    id: c
    name: C
`;
    const result = reconcile(source, { services: [{ id: "b", name: "B" }, { id: "a", name: "Renamed A" }, { id: "d", name: "New D" }] });
    expect(result.document.toJS().services.map((service: { id: string }) => service.id)).toEqual(["b", "a", "d"]);
    expect(itemComment(result.source, "services", "a")).toContain("owner A");
    expect(itemComment(result.source, "services", "a")).toContain("name A");
    expect(itemComment(result.source, "services", "b")).toContain("owner B");
    expect(itemComment(result.source, "services", "b")).not.toContain("owner A");
    expect(itemComment(result.source, "services", "d")).not.toMatch(/owner [ABC]/);
    expect(result.source).not.toContain("deleted credential");
    expect(result.source).not.toContain("removed C");
    const secondSave = reconcile(result.source, { services: [{ id: "a", name: "Renamed again" }, { id: "d", name: "New D" }] });
    expect(itemComment(secondSave.source, "services", "a")).toContain("owner A");
    expect(secondSave.source).not.toContain("owner B");
    expect(secondSave.source).not.toContain("name B");
  });

  it("keeps two tiles sharing one service distinct across reorder and nested widget edits", () => {
    const result = reconcile(`service_tiles:
  - id: a # tile A
    service_id: shared
    footprint: { columnSpan: 3, rowSpan: 2 } # dimensions A
    widget:
      type: example
      config:
        limit: 3 # limit A
  - id: b # tile B
    service_id: shared
    widget:
      type: example
      config:
        limit: 7 # limit B
`, { service_tiles: [
      { id: "b", service_id: "shared", widget: { type: "example", config: { limit: 9 } } },
      { id: "a", service_id: "shared", footprint: { columnSpan: 6, rowSpan: 2 }, widget: { type: "example", config: { limit: 5 } } },
    ] });
    expect(result.source).toMatch(/id: b # tile B[\s\S]*limit: 9 # limit B[\s\S]*id: a # tile A[\s\S]*limit: 5 # limit A/);
    expect(result.source).toContain("columnSpan: 6");
    expect(result.source).toContain("# dimensions A");
  });

  it("matches named groups case-insensitively and treats actual renames as add/remove", () => {
    const result = reconcile(`groups:
  - name: Media # media owner
    collapsed: false # retained property
  - name: Work # work owner
  - name: Old # removed owner
bookmarks:
  - name: Links # bookmark owner
    links: []
`, {
      groups: [{ name: "WORK" }, { name: "media", collapsed: true }, { name: "Renamed" }],
      bookmarks: [{ name: "links", accent: "red", links: [] }],
    });
    expect(result.source).toContain("WORK # work owner");
    expect(result.source).toContain("media # media owner");
    expect(result.source).toContain("true # retained property");
    expect(result.source).not.toContain("removed owner");
    expect(result.source).toContain("links # bookmark owner");
  });

  it("moves bookmark link comments for exact identities and unambiguous one-field edits", () => {
    const result = reconcile(`bookmarks:
  - name: Links
    links:
      - name: A # A owner
        url: https://a.example
      - name: B # B owner
        url: https://b.example
      - name: C # C owner
        url: https://c.example
`, { bookmarks: [{ name: "Links", links: [
      { name: "B", url: "https://b.example" },
      { name: "A", url: "https://new-a.example" },
      { name: "New C", url: "https://c.example" },
    ] }] });
    expect(result.source).toMatch(/name: B # B owner[\s\S]*name: A # A owner[\s\S]*name: New C # C owner/);
    expect(result.document.toJS().bookmarks[0].links[1].url).toBe("https://new-a.example");
  });

  it("does not guess ownership for duplicate or simultaneously replaced bookmark links", () => {
    const result = reconcile(`bookmarks:
  - name: Links
    links:
      - name: Duplicate # duplicate one
        url: https://same.example
      - name: Duplicate # duplicate two
        url: https://same.example
      - name: Both changed # removed complete identity
        url: https://old.example
`, { bookmarks: [{ name: "Links", links: [
      { name: "Duplicate", url: "https://same.example" },
      { name: "Duplicate", url: "https://same.example" },
      { name: "New name", url: "https://new.example" },
    ] }] });
    expect(result.source).not.toContain("duplicate one");
    expect(result.source).not.toContain("duplicate two");
    expect(result.source).not.toContain("removed complete identity");
  });

  it("preserves a sequence's own comments when the sequence becomes empty", () => {
    const result = reconcile(`services:
  # sequence owner
  - id: a # removed item
    name: A
  # sequence end
`, { services: [] });
    expect(result.document.toJS()).toEqual({ services: [] });
    expect(result.source).toContain("sequence owner");
    expect(result.source).toContain("sequence end");
    expect(result.source).not.toContain("removed item");
  });

  it("matches unique primitive options by value but replaces arbitrary changed object arrays", () => {
    const result = reconcile(`extension:
  primitive:
    - a # a owner
    - b # b owner
    - duplicate # duplicate one
    - duplicate # duplicate two
  records: # owning field
    - x: 1 # arbitrary owner
  nested:
    - [1, 2] # nested owner
`, { extension: {
      primitive: ["b", "a", "duplicate"], records: [{ x: 2 }], nested: [[2, 1]],
    } });
    expect(result.source).toMatch(/- b # b owner\n[ ]+- a # a owner/);
    expect(result.source).not.toContain("duplicate one");
    expect(result.source).not.toContain("duplicate two");
    expect(result.source).toContain("owning field");
    expect(result.source).not.toContain("arbitrary owner");
    expect(result.source).not.toContain("nested owner");
  });

  it("retains leading primitive-item ownership through repeated saves", () => {
    const first = reconcile(`extension:
  - # owner A
    a
  - # owner B
    b
`, { extension: ["b", "a"] });
    const second = reconcile(first.source, { extension: ["a"] });
    expect(second.source).toContain("owner A");
    expect(second.source).not.toContain("owner B");
  });

  it("retains only field comments on scalar/map/sequence type replacements", () => {
    const result = reconcile(`extension:
  scalar: before # scalar owner
  mapping: # mapping owner
    child: value # removed child
  array: # array owner
    - 1 # removed item
`, { extension: { scalar: { child: "after" }, mapping: "now scalar", array: { child: "now map" } } });
    expect(result.document.toJS().extension).toEqual({ scalar: { child: "after" }, mapping: "now scalar", array: { child: "now map" } });
    expect(result.source).toContain("scalar owner");
    expect(result.source).toContain("mapping owner");
    expect(result.source).toContain("array owner");
    expect(result.source).not.toContain("removed child");
    expect(result.source).not.toContain("removed item");
  });

  it("allows an ordinary tagged scalar to change type without retaining the old type constraint", () => {
    const result = reconcile("extension:\n  value: !!str before # field owner\n", { extension: { value: false } });
    expect(result.document.toJS().extension.value).toBe(false);
    expect(result.source).toContain("# field owner");
  });

  it("allows unshared anchors and untouched shared aliases during ordinary updates", () => {
    const result = reconcile(`appearance: &unshared
  theme: dark # theme owner
extension:
  original: &shared { keep: true }
  alias: *shared
`, { appearance: { theme: "light" } });
    expect(result.source).toContain("&unshared");
    expect(result.source).toContain("light # theme owner");
    expect(result.source).toContain("alias: *shared");
    expect(result.document.toJS().extension.alias).toEqual({ keep: true });
  });

  it("allows a changed sibling beside an unchanged alias without expanding shared data", () => {
    const result = reconcile(`extension:
  original: &shared { keep: true }
  alias: *shared
  mutable: old
`, { extension: { original: { keep: true }, alias: { keep: true }, mutable: "new" } });
    expect(result.source).toContain("alias: *shared");
    expect(result.document.toJS().extension.mutable).toBe("new");
  });

  it.each([
    ["changing the shared anchor", "appearance: &shared { theme: dark }\nextension: *shared\n", { appearance: { theme: "light" } }],
    ["changing a shared alias", "extension: &shared { theme: dark }\nappearance: *shared\n", { appearance: { theme: "light" } }],
    ["deleting a referenced anchor", "extension:\n  original: &shared { keep: true }\n  alias: *shared\n", { extension: { alias: { keep: true } } }],
    ["moving an anchor after its alias", "services:\n  - id: a\n    name: &shared Name\n  - id: b\n    name: *shared\n", { services: [{ id: "b", name: "Name" }, { id: "a", name: "Name" }] }],
  ])("rejects unsupported graph edits: %s", (_description, source, updates) => {
    expect(() => reconcile(source as string, updates as Record<string, unknown>)).toThrow(UnsupportedYamlUpdateError);
  });
});
