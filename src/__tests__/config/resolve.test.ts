import { describe, it, expect } from "vitest";
import {
  resolveServiceSize,
  resolveGroupOrder,
  sizeSatisfies,
  SIZE_SPANS,
  DEFAULT_SIZE,
  DEFAULT_BOOKMARK_STYLE,
} from "@/config/resolve";
import { KokpitConfigSchema, type KokpitConfig } from "@/config/schema";

function makeConfig(partial: Record<string, unknown>): KokpitConfig {
  const r = KokpitConfigSchema.safeParse({ schema_version: 1, ...partial });
  if (!r.success) throw new Error(r.error.message);
  return r.data;
}

describe("resolveServiceSize", () => {
  it("returns the explicit size when set", () => {
    expect(resolveServiceSize({ size: "large" }, "normal")).toBe("large");
  });

  it("explicit size wins over legacy position and widget hint", () => {
    expect(
      resolveServiceSize(
        { size: "normal", position: { col: 1, row: 1, width: 2, height: 2 } },
        "tall"
      )
    ).toBe("normal");
  });

  it.each([
    [{ col: 1, row: 1, width: 2, height: 2 }, "large"],
    [{ col: 1, row: 1, width: 3, height: 2 }, "large"],
    [{ col: 1, row: 1, width: 2, height: 1 }, "wide"],
    [{ col: 1, row: 1, width: 1, height: 2 }, "tall"],
    [{ col: 1, row: 1, width: 1, height: 3 }, "tall"],
    [{ col: 1, row: 1, width: 1, height: 1 }, "normal"],
  ] as const)("maps legacy position %o to %s", (position, expected) => {
    expect(resolveServiceSize({ position })).toBe(expected);
  });

  it("legacy position wins over the widget hint", () => {
    expect(
      resolveServiceSize(
        { position: { col: 1, row: 1, width: 2, height: 1 } },
        "tall"
      )
    ).toBe("wide");
  });

  it("falls back to the widget preferred size", () => {
    expect(resolveServiceSize({}, "tall")).toBe("tall");
  });

  it("defaults to normal when nothing applies", () => {
    expect(resolveServiceSize({})).toBe("normal");
    expect(DEFAULT_SIZE).toBe("normal");
  });

  it("clamps an explicit size below the widget minSize up to the floor", () => {
    // Hand-edited YAML: explicit normal under a tall floor renders at tall.
    expect(resolveServiceSize({ size: "normal" }, undefined, "tall")).toBe("tall");
    expect(resolveServiceSize({ size: "wide" }, undefined, "large")).toBe("large");
  });

  it("clamps a legacy position below the widget minSize up to the floor", () => {
    expect(
      resolveServiceSize(
        { position: { col: 1, row: 1, width: 1, height: 1 } },
        undefined,
        "tall"
      )
    ).toBe("tall");
  });

  it("leaves a size at or above the widget minSize unchanged", () => {
    expect(resolveServiceSize({ size: "large" }, undefined, "tall")).toBe("large");
    expect(resolveServiceSize({ size: "tall" }, undefined, "tall")).toBe("tall");
  });

  it("does not clamp when no minSize is declared (unchanged behavior)", () => {
    expect(resolveServiceSize({ size: "normal" }, "large")).toBe("normal");
  });
});

describe("sizeSatisfies", () => {
  it("large satisfies every preset", () => {
    for (const min of Object.keys(SIZE_SPANS) as Array<
      keyof typeof SIZE_SPANS
    >) {
      expect(sizeSatisfies("large", min)).toBe(true);
    }
  });

  it("wide does not satisfy tall (and vice versa)", () => {
    expect(sizeSatisfies("wide", "tall")).toBe(false);
    expect(sizeSatisfies("tall", "wide")).toBe(false);
  });

  it("normal only satisfies normal", () => {
    expect(sizeSatisfies("normal", "normal")).toBe(true);
    expect(sizeSatisfies("normal", "wide")).toBe(false);
    expect(sizeSatisfies("normal", "tall")).toBe(false);
    expect(sizeSatisfies("normal", "large")).toBe(false);
  });
});

describe("resolveGroupOrder", () => {
  it("keeps declared groups in array order (not alphabetical)", () => {
    const config = makeConfig({
      groups: [{ name: "Zebra" }, { name: "Alpha" }],
      services: [
        { name: "A", group: "Alpha" },
        { name: "Z", group: "Zebra" },
      ],
    });
    expect(resolveGroupOrder(config).map((g) => g.name)).toEqual([
      "Zebra",
      "Alpha",
    ]);
  });

  it("auto-appends undeclared referenced groups alphabetically after declared ones", () => {
    const config = makeConfig({
      groups: [{ name: "Media" }],
      services: [
        { name: "A", group: "Zulu" },
        { name: "B", group: "Bravo" },
        { name: "C", group: "Media" },
      ],
    });
    const order = resolveGroupOrder(config);
    expect(order.map((g) => g.name)).toEqual(["Media", "Bravo", "Zulu"]);
    expect(order.map((g) => g.declared)).toEqual([true, false, false]);
  });

  it("matches declared names case-insensitively (no duplicate section)", () => {
    const config = makeConfig({
      groups: [{ name: "Media" }],
      services: [{ name: "A", group: "media" }],
    });
    expect(resolveGroupOrder(config).map((g) => g.name)).toEqual(["Media"]);
  });

  it("includes groups referenced only by bookmark placements", () => {
    const config = makeConfig({
      services: [],
      bookmarks: [
        { name: "Dev", placement: { group: "Infrastructure" }, links: [] },
      ],
    });
    expect(resolveGroupOrder(config).map((g) => g.name)).toEqual([
      "Infrastructure",
    ]);
  });

  it("places the ungrouped section last by default", () => {
    const config = makeConfig({
      groups: [{ name: "Media" }],
      services: [{ name: "A", group: "Media" }, { name: "B" }],
    });
    expect(resolveGroupOrder(config).map((g) => g.name)).toEqual([
      "Media",
      null,
    ]);
  });

  it("places the ungrouped section first when layout.ungrouped is 'first'", () => {
    const config = makeConfig({
      layout: { columns: 4, row_height: 120, ungrouped: "first" },
      groups: [{ name: "Media" }],
      services: [{ name: "A", group: "Media" }, { name: "B" }],
    });
    expect(resolveGroupOrder(config).map((g) => g.name)).toEqual([
      null,
      "Media",
    ]);
  });

  it("omits the ungrouped section when every service has a group", () => {
    const config = makeConfig({
      services: [{ name: "A", group: "Media" }],
    });
    expect(resolveGroupOrder(config).map((g) => g.name)).toEqual(["Media"]);
  });

  it("treats a whitespace-only group reference as ungrouped", () => {
    const config = makeConfig({
      services: [{ name: "A", group: "  " }],
    });
    expect(resolveGroupOrder(config).map((g) => g.name)).toEqual([null]);
  });

  it("carries collapsed and columns through from declarations", () => {
    const config = makeConfig({
      groups: [{ name: "Media", collapsed: true, columns: 6 }],
      services: [],
    });
    expect(resolveGroupOrder(config)).toEqual([
      { name: "Media", declared: true, collapsed: true, columns: 6 },
    ]);
  });

  it("returns an empty list for an empty config", () => {
    const config = makeConfig({ services: [] });
    expect(resolveGroupOrder(config)).toEqual([]);
  });
});

describe("defaults", () => {
  it("exposes the resolve-time bookmark style default", () => {
    expect(DEFAULT_BOOKMARK_STYLE).toBe("list");
  });
});
