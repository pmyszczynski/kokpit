import { describe, it, expect } from "vitest";
import { KokpitConfigSchema } from "@/config/schema";

const minimalValid = {
  schema_version: 1 as const,
  services: [{ name: "A" }],
};

describe("KokpitConfigSchema", () => {
  it("accepts unique service names", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      services: [{ name: "Plex" }, { name: "Sonarr" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects duplicate service names (case-insensitive)", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      services: [{ name: "Plex" }, { name: "plex" }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["services", 1, "name"] }),
        ])
      );
    }
  });

  it("rejects duplicate names after trim", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      services: [{ name: "Plex " }, { name: " Plex" }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["services", 1, "name"] }),
        ])
      );
    }
  });

  it("rejects whitespace-only service name", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      services: [{ name: "   " }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["services", 0, "name"] }),
        ])
      );
    }
  });
});

describe("KokpitConfigSchema – service size", () => {
  it.each(["normal", "wide", "tall", "large"] as const)(
    "accepts size %s",
    (size) => {
      const r = KokpitConfigSchema.safeParse({
        ...minimalValid,
        services: [{ name: "Plex", size }],
      });
      expect(r.success).toBe(true);
    }
  );

  it("rejects an unknown size value", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      services: [{ name: "Plex", size: "huge" }],
    });
    expect(r.success).toBe(false);
  });

  it("still parses the deprecated position field", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      services: [
        { name: "Plex", position: { col: 1, row: 1, width: 2, height: 2 } },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe("KokpitConfigSchema – layout.ungrouped", () => {
  it.each(["first", "last"] as const)("accepts %s", (ungrouped) => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      layout: { columns: 4, row_height: 120, ungrouped },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown placement value", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      layout: { columns: 4, row_height: 120, ungrouped: "middle" },
    });
    expect(r.success).toBe(false);
  });

  it("stays undefined when omitted (no schema default)", () => {
    const r = KokpitConfigSchema.safeParse(minimalValid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.layout.ungrouped).toBeUndefined();
  });
});

describe("KokpitConfigSchema – groups", () => {
  it("accepts declared groups with collapsed and columns", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      groups: [
        { name: "Media", collapsed: false, columns: 4 },
        { name: "Downloads" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects duplicate group names (case-insensitive)", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      groups: [{ name: "Media" }, { name: "media" }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["groups", 1, "name"] }),
        ])
      );
    }
  });

  it("rejects whitespace-only group name", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      groups: [{ name: "  " }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-positive group columns", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      groups: [{ name: "Media", columns: 0 }],
    });
    expect(r.success).toBe(false);
  });
});

describe("KokpitConfigSchema – bookmarks", () => {
  const validBookmarks = [
    {
      name: "Dev",
      accent: "#7aa2f7",
      style: "list",
      placement: { group: "Infrastructure", size: "tall" },
      links: [
        { name: "GitHub", url: "https://github.com", icon: "sh-github" },
        {
          name: "Grafana docs",
          url: "https://grafana.com/docs",
          abbr: "GD",
          description: "Panels & alerting reference",
        },
      ],
    },
  ];

  it("accepts a full bookmark group", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      bookmarks: validBookmarks,
    });
    expect(r.success).toBe(true);
  });

  it("leaves an omitted style undefined (resolve-time default)", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      bookmarks: [{ name: "Dev", links: [] }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.bookmarks?.[0].style).toBeUndefined();
  });

  it("rejects duplicate bookmark group names (case-insensitive)", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      bookmarks: [
        { name: "Dev", links: [] },
        { name: " dev ", links: [] },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["bookmarks", 1, "name"] }),
        ])
      );
    }
  });

  it("rejects a link with an invalid URL", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      bookmarks: [
        { name: "Dev", links: [{ name: "Broken", url: "not-a-url" }] },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an abbr longer than 2 characters", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      bookmarks: [
        {
          name: "Dev",
          links: [{ name: "GitHub", url: "https://github.com", abbr: "GHB" }],
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown style value", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      bookmarks: [{ name: "Dev", style: "grid", links: [] }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a bookmark group without links", () => {
    const r = KokpitConfigSchema.safeParse({
      ...minimalValid,
      bookmarks: [{ name: "Dev" }],
    });
    expect(r.success).toBe(false);
  });
});
