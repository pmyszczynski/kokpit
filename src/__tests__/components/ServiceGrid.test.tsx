import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { KokpitConfig, Service } from "@/config/schema";

const getConfig = vi.fn();

vi.mock("@/config", () => ({
  getConfig: () => getConfig(),
}));

import ServiceGrid from "@/components/ServiceGrid";
import "@/integrations";
import { getAllWidgets } from "@/widgets";

// Every registered widget type, with what its schema says about an empty
// config. Derived from the registry so new integrations are covered
// automatically.
const allTiles = getAllWidgets().map((w) => ({
  id: w.id,
  emptyConfigValid: w.configSchema.safeParse({}).success,
}));

function makeService(overrides: Partial<Service> & { name: string }): Service {
  return { ...overrides };
}

// Minimal config shape ServiceGrid consumes; layout is always present in a
// parsed config (schema default), so the mock provides it too.
function makeConfig(
  overrides: Partial<KokpitConfig> = {}
): Pick<KokpitConfig, "layout" | "services"> &
  Partial<Pick<KokpitConfig, "groups" | "bookmarks">> {
  return {
    layout: { columns: 4, row_height: 120 },
    services: [],
    ...overrides,
  };
}

function sectionHeaders(container: HTMLElement): (string | null)[] {
  return Array.from(
    container.querySelectorAll("h2.service-group__header")
  ).map((h) => h.textContent);
}

describe("ServiceGrid", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true }),
      } as Response)
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    getConfig.mockReset();
    window.localStorage.clear();
  });

  it("renders null when there are no services and no bookmarks", async () => {
    getConfig.mockReturnValue(makeConfig());
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });
    expect(container.innerHTML).toBe("");
  });

  it("renders ungrouped services in a plain dashboard-tile-grid", async () => {
    getConfig.mockReturnValue(
      makeConfig({
        services: [
          makeService({ name: "Jellyfin", url: "http://jellyfin.local" }),
          makeService({ name: "Portainer", url: "http://portainer.local" }),
        ],
      })
    );
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });
    expect(screen.getByText("Jellyfin")).toBeInTheDocument();
    expect(screen.getByText("Portainer")).toBeInTheDocument();
    expect(container.querySelectorAll(".service-group")).toHaveLength(0);
    const grid = container.querySelector(".dashboard-tile-grid");
    expect(grid).not.toBeNull();
    expect(grid?.querySelectorAll(".service-tile")).toHaveLength(2);
  });

  it("auto-appends undeclared groups alphabetically (legacy fallback)", async () => {
    getConfig.mockReturnValue(
      makeConfig({
        services: [
          makeService({ name: "Sonarr", url: "http://sonarr.local", group: "Zeta" }),
          makeService({ name: "Radarr", url: "http://radarr.local", group: "Alpha" }),
          makeService({ name: "Jellyfin", url: "http://jellyfin.local", group: "Alpha" }),
        ],
      })
    );
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });

    expect(sectionHeaders(container)).toEqual(["Alpha", "Zeta"]);

    const groups = container.querySelectorAll(".service-group");
    expect(groups).toHaveLength(2);
    const alphaGroup = groups[0];
    expect(alphaGroup.textContent).toContain("Radarr");
    expect(alphaGroup.textContent).toContain("Jellyfin");
    const zetaGroup = groups[1];
    expect(zetaGroup.textContent).toContain("Sonarr");
  });

  it("orders sections by the declared groups: array, not alphabetically", async () => {
    getConfig.mockReturnValue(
      makeConfig({
        groups: [{ name: "Zeta" }, { name: "Alpha" }],
        services: [
          makeService({ name: "Radarr", group: "Alpha" }),
          makeService({ name: "Sonarr", group: "Zeta" }),
        ],
      })
    );
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });
    expect(sectionHeaders(container)).toEqual(["Zeta", "Alpha"]);
  });

  it("appends undeclared groups after declared ones, alphabetically", async () => {
    getConfig.mockReturnValue(
      makeConfig({
        groups: [{ name: "Media" }],
        services: [
          makeService({ name: "S1", group: "Zeta" }),
          makeService({ name: "S2", group: "Alpha" }),
          makeService({ name: "S3", group: "Media" }),
        ],
      })
    );
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });
    expect(sectionHeaders(container)).toEqual(["Media", "Alpha", "Zeta"]);
  });

  it("skips declared groups with no services or bookmark tiles", async () => {
    getConfig.mockReturnValue(
      makeConfig({
        groups: [{ name: "Empty" }, { name: "Media" }],
        services: [makeService({ name: "Plex", group: "Media" })],
      })
    );
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });
    expect(sectionHeaders(container)).toEqual(["Media"]);
  });

  it("renders the ungrouped section last by default", async () => {
    getConfig.mockReturnValue(
      makeConfig({
        services: [
          makeService({ name: "Loose" }),
          makeService({ name: "Grouped", group: "Media" }),
        ],
      })
    );
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });
    const children = Array.from(container.children);
    expect(children[0].classList.contains("service-group")).toBe(true);
    expect(children[1].classList.contains("dashboard-tile-grid")).toBe(true);
    expect(children[1].textContent).toContain("Loose");
  });

  it("renders the ungrouped section first when layout.ungrouped is 'first'", async () => {
    getConfig.mockReturnValue(
      makeConfig({
        layout: { columns: 4, row_height: 120, ungrouped: "first" },
        services: [
          makeService({ name: "Loose" }),
          makeService({ name: "Grouped", group: "Media" }),
        ],
      })
    );
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });
    const children = Array.from(container.children);
    expect(children[0].classList.contains("dashboard-tile-grid")).toBe(true);
    expect(children[0].textContent).toContain("Loose");
    expect(children[1].classList.contains("service-group")).toBe(true);
  });

  it("sets the per-group columns override as a CSS variable on the tile grid", async () => {
    getConfig.mockReturnValue(
      makeConfig({
        groups: [{ name: "Media", columns: 6 }],
        services: [makeService({ name: "Plex", group: "Media" })],
      })
    );
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });
    const grid = container.querySelector<HTMLElement>(
      ".service-group .dashboard-tile-grid"
    );
    expect(grid?.style.getPropertyValue("--group-columns")).toBe("6");
  });

  it("passes the YAML collapsed default to the group section", async () => {
    getConfig.mockReturnValue(
      makeConfig({
        groups: [{ name: "Media", collapsed: true }],
        services: [makeService({ name: "Plex", group: "Media" })],
      })
    );
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });
    const section = container.querySelector(".service-group");
    expect(section?.classList.contains("service-group--collapsed")).toBe(true);
    expect(
      section?.querySelector(".service-group__toggle")
    ).toHaveAttribute("aria-expanded", "false");
  });

  describe("tile sizes", () => {
    it("defaults widgetless services to service-tile--normal", async () => {
      getConfig.mockReturnValue(
        makeConfig({ services: [makeService({ name: "Plain" })] })
      );
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(<ServiceGrid />));
      });
      expect(container.querySelector(".service-tile--normal")).not.toBeNull();
    });

    it("applies the explicit size preset as a class", async () => {
      getConfig.mockReturnValue(
        makeConfig({ services: [makeService({ name: "Big", size: "large" })] })
      );
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(<ServiceGrid />));
      });
      expect(container.querySelector(".service-tile--large")).not.toBeNull();
    });

    it("uses the widget's preferredSize hint when no explicit size is set", async () => {
      // plex declares preferredSize: "wide" in its widget definition.
      getConfig.mockReturnValue(
        makeConfig({
          services: [
            makeService({ name: "Plex", widget: { type: "plex" } }),
          ],
        })
      );
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(<ServiceGrid />));
      });
      expect(container.querySelector(".service-tile--wide")).not.toBeNull();
    });

    it("explicit size wins over the widget hint", async () => {
      getConfig.mockReturnValue(
        makeConfig({
          services: [
            makeService({ name: "Plex", size: "normal", widget: { type: "plex" } }),
          ],
        })
      );
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(<ServiceGrid />));
      });
      expect(container.querySelector(".service-tile--normal")).not.toBeNull();
      expect(container.querySelector(".service-tile--wide")).toBeNull();
    });
  });

  describe("bookmark tiles", () => {
    it("renders a placed bookmark group as one tile after that group's services", async () => {
      getConfig.mockReturnValue(
        makeConfig({
          services: [makeService({ name: "Plex", group: "Media" })],
          bookmarks: [
            {
              name: "Docs",
              links: [{ name: "GitHub", url: "https://github.com" }],
              placement: { group: "Media" },
            },
          ],
        })
      );
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(<ServiceGrid />));
      });
      expect(sectionHeaders(container)).toEqual(["Media"]);
      const grid = container.querySelector(".service-group .dashboard-tile-grid");
      const tiles = Array.from(grid?.children ?? []);
      expect(tiles).toHaveLength(2);
      expect(tiles[0].classList.contains("service-tile")).toBe(true);
      expect(tiles[1].classList.contains("bookmark-tile")).toBe(true);
    });

    it("creates a section for a group referenced only by a bookmark placement", async () => {
      getConfig.mockReturnValue(
        makeConfig({
          services: [makeService({ name: "Loose" })],
          bookmarks: [
            {
              name: "Docs",
              links: [{ name: "GitHub", url: "https://github.com" }],
              placement: { group: "Reading" },
            },
          ],
        })
      );
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(<ServiceGrid />));
      });
      expect(sectionHeaders(container)).toEqual(["Reading"]);
      expect(
        container.querySelector(".service-group .bookmark-tile")
      ).not.toBeNull();
    });

    it("renders unplaced bookmarks in an implicit 'Bookmarks' section after everything", async () => {
      getConfig.mockReturnValue(
        makeConfig({
          layout: { columns: 4, row_height: 120, ungrouped: "first" },
          services: [
            makeService({ name: "Loose" }),
            makeService({ name: "Plex", group: "Media" }),
          ],
          bookmarks: [
            {
              name: "Dev",
              links: [{ name: "GitHub", url: "https://github.com" }],
            },
          ],
        })
      );
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(<ServiceGrid />));
      });
      expect(sectionHeaders(container)).toEqual(["Media", "Bookmarks"]);
      // Last section is the implicit Bookmarks group, even though the
      // ungrouped section is configured first.
      const children = Array.from(container.children);
      const last = children[children.length - 1];
      expect(last.classList.contains("service-group")).toBe(true);
      expect(last.querySelector(".bookmark-tile")).not.toBeNull();
      expect(last.textContent).toContain("Dev");
    });

    it("renders bookmarks even when there are no services", async () => {
      getConfig.mockReturnValue(
        makeConfig({
          bookmarks: [
            {
              name: "Dev",
              links: [{ name: "GitHub", url: "https://github.com" }],
            },
          ],
        })
      );
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(<ServiceGrid />));
      });
      expect(sectionHeaders(container)).toEqual(["Bookmarks"]);
      expect(container.querySelector(".bookmark-tile")).not.toBeNull();
    });

    it("defaults bookmark tile sizes per style (list→tall, icon-grid/compact→normal)", async () => {
      getConfig.mockReturnValue(
        makeConfig({
          bookmarks: [
            { name: "L", style: "list", links: [{ name: "A", url: "https://a.example" }] },
            { name: "G", style: "icon-grid", links: [{ name: "B", url: "https://b.example" }] },
            { name: "C", style: "compact", links: [{ name: "C", url: "https://c.example" }] },
            {
              name: "P",
              style: "list",
              placement: { size: "large" },
              links: [{ name: "D", url: "https://d.example" }],
            },
          ],
        })
      );
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(<ServiceGrid />));
      });
      expect(
        container.querySelector(".bookmark-tile--list.bookmark-tile--tall")
      ).not.toBeNull();
      expect(
        container.querySelector(".bookmark-tile--icon-grid.bookmark-tile--normal")
      ).not.toBeNull();
      expect(
        container.querySelector(".bookmark-tile--compact.bookmark-tile--normal")
      ).not.toBeNull();
      expect(
        container.querySelector(".bookmark-tile--list.bookmark-tile--large")
      ).not.toBeNull();
    });
  });

  it("renders the widget when its config passes the widget schema", async () => {
    getConfig.mockReturnValue(
      makeConfig({
        services: [
          makeService({
            name: "Plex",
            url: "http://plex.local",
            widget: {
              type: "plex",
              config: { url: "http://plex.local:32400", token: "t" },
            },
          }),
        ],
      })
    );
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });
    expect(
      container.querySelector('.service-tile__widget[data-widget-type="plex"]')
    ).not.toBeNull();
  });

  it.each(allTiles)(
    "$id: renders per its schema when the widget has no config",
    async ({ id, emptyConfigValid }) => {
      getConfig.mockReturnValue(
        makeConfig({
          services: [
            makeService({
              name: "Svc",
              url: "http://svc.local",
              widget: { type: id },
            }),
          ],
        })
      );
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(<ServiceGrid />));
      });
      expect(screen.getByText("Svc")).toBeInTheDocument();
      if (emptyConfigValid) {
        // Schema accepts an empty config — the widget renders.
        expect(container.querySelector(".service-tile__widget")).not.toBeNull();
      } else {
        // Unconfigured widget — plain link tile, no error box.
        expect(container.querySelector(".service-tile__widget")).toBeNull();
        expect(container.querySelector(".widget-error")).toBeNull();
      }
    }
  );

  it("renders a plain tile when the widget config is partial/invalid", async () => {
    getConfig.mockReturnValue(
      makeConfig({
        services: [
          makeService({
            name: "Plex",
            url: "http://plex.local",
            widget: {
              type: "plex",
              config: { url: "http://plex.local:32400" }, // token missing
            },
          }),
        ],
      })
    );
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });
    expect(screen.getByText("Plex")).toBeInTheDocument();
    expect(container.querySelector(".service-tile__widget")).toBeNull();
    expect(container.querySelector(".widget-error")).toBeNull();
  });

  it("keeps the error box for an unknown widget type", async () => {
    getConfig.mockReturnValue(
      makeConfig({
        services: [
          makeService({
            name: "Mystery",
            widget: { type: "not-a-real-widget" },
          }),
        ],
      })
    );
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });
    expect(container.querySelector(".widget-error")).not.toBeNull();
    expect(screen.getByText(/unknown widget type/i)).toBeInTheDocument();
  });

  it("renders both grouped and ungrouped services together", async () => {
    getConfig.mockReturnValue(
      makeConfig({
        services: [
          makeService({ name: "Grouped", url: "http://grouped.local", group: "Media" }),
          makeService({ name: "Loose", url: "http://loose.local" }),
        ],
      })
    );
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });

    expect(container.querySelectorAll(".service-group")).toHaveLength(1);
    expect(screen.getByText("Media")).toBeInTheDocument();
    // ungrouped grid is a sibling dashboard-tile-grid outside of .service-group
    const ungroupedGrids = Array.from(
      container.querySelectorAll(".dashboard-tile-grid")
    ).filter((el) => !el.closest(".service-group"));
    expect(ungroupedGrids).toHaveLength(1);
    expect(ungroupedGrids[0].textContent).toContain("Loose");
  });
});
