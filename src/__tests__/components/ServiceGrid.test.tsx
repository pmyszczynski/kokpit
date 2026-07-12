import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { Service } from "@/config/schema";

const getConfig = vi.fn();

vi.mock("@/config", () => ({
  getConfig: () => getConfig(),
}));

import ServiceGrid from "@/components/ServiceGrid";

function makeService(overrides: Partial<Service> & { name: string }): Service {
  return { ...overrides };
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
  });

  it("renders null when there are no services", async () => {
    getConfig.mockReturnValue({ services: [] });
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });
    expect(container.innerHTML).toBe("");
  });

  it("renders ungrouped services in a plain dashboard-tile-grid", async () => {
    getConfig.mockReturnValue({
      services: [
        makeService({ name: "Jellyfin", url: "http://jellyfin.local" }),
        makeService({ name: "Portainer", url: "http://portainer.local" }),
      ],
    });
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

  it("groups services under a service-group__header and sorts groups alphabetically", async () => {
    getConfig.mockReturnValue({
      services: [
        makeService({ name: "Sonarr", url: "http://sonarr.local", group: "Zeta" }),
        makeService({ name: "Radarr", url: "http://radarr.local", group: "Alpha" }),
        makeService({ name: "Jellyfin", url: "http://jellyfin.local", group: "Alpha" }),
      ],
    });
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });

    const headers = Array.from(
      container.querySelectorAll("h2.service-group__header")
    ).map((h) => h.textContent);
    expect(headers).toEqual(["Alpha", "Zeta"]);

    const groups = container.querySelectorAll(".service-group");
    expect(groups).toHaveLength(2);
    // Alpha group should contain both Radarr and Jellyfin
    const alphaGroup = groups[0];
    expect(alphaGroup.textContent).toContain("Radarr");
    expect(alphaGroup.textContent).toContain("Jellyfin");
    const zetaGroup = groups[1];
    expect(zetaGroup.textContent).toContain("Sonarr");
  });

  it("renders the widget when its config passes the widget schema", async () => {
    getConfig.mockReturnValue({
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
    });
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });
    expect(
      container.querySelector('.service-tile__widget[data-widget-type="plex"]')
    ).not.toBeNull();
  });

  it("renders a plain tile when the widget has no config", async () => {
    getConfig.mockReturnValue({
      services: [
        makeService({
          name: "Plex",
          url: "http://plex.local",
          widget: { type: "plex" },
        }),
      ],
    });
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });
    expect(screen.getByText("Plex")).toBeInTheDocument();
    expect(container.querySelector(".service-tile__widget")).toBeNull();
    expect(container.querySelector(".widget-error")).toBeNull();
  });

  it("renders a plain tile when the widget config is partial/invalid", async () => {
    getConfig.mockReturnValue({
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
    });
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });
    expect(screen.getByText("Plex")).toBeInTheDocument();
    expect(container.querySelector(".service-tile__widget")).toBeNull();
    expect(container.querySelector(".widget-error")).toBeNull();
  });

  it("keeps the error box for an unknown widget type", async () => {
    getConfig.mockReturnValue({
      services: [
        makeService({
          name: "Mystery",
          widget: { type: "not-a-real-widget" },
        }),
      ],
    });
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<ServiceGrid />));
    });
    expect(container.querySelector(".widget-error")).not.toBeNull();
    expect(screen.getByText(/unknown widget type/i)).toBeInTheDocument();
  });

  it("renders both grouped and ungrouped services together", async () => {
    getConfig.mockReturnValue({
      services: [
        makeService({ name: "Grouped", url: "http://grouped.local", group: "Media" }),
        makeService({ name: "Loose", url: "http://loose.local" }),
      ],
    });
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
