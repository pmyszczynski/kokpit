import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ServiceTile from "@/components/ServiceTile";
import type { WidgetConfigIssue } from "@/widgets/tileWidget";
import { z } from "zod";
import { clearRegistry, registerWidget } from "@/widgets";

// The broken-widget badge reads edit-mode availability via
// useEditModeOptional(), independently of any wrapping <EditModeProvider> (it
// must work with no provider at all — that's the whole point of the "Optional"
// hook). Mocking it directly, with a mutable ref tests can point at whatever
// they need, is far simpler than standing up a real provider (fetch/router
// mocking) just to flip `canEdit`.
const editModeOptional = vi.hoisted(() => ({
  current: null as null | { canEdit: boolean; requestServiceEdit: (name: string) => void },
}));
vi.mock("@/components/edit/EditModeProvider", () => ({
  useEditModeOptional: () => editModeOptional.current,
}));

describe("ServiceTile", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true, status: 200 }),
      } as Response)
    );
    editModeOptional.current = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    editModeOptional.current = null;
    vi.unstubAllGlobals();
    clearRegistry();
  });

  it("renders the service name", async () => {
    await act(async () => {
      render(<ServiceTile name="Jellyfin" url="http://192.168.1.10:8096" />);
    });
    expect(screen.getByText("Jellyfin")).toBeInTheDocument();
  });

  it("groups the service icon and name in the same header row", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile
          name="Jellyfin"
          url="http://192.168.1.10:8096"
          icon="/icons/jellyfin.png"
        />
      ));
    });

    const header = container.querySelector(".service-tile__header");
    expect(header).not.toBeNull();
    expect(header?.children).toHaveLength(2);
    expect(header?.children[0]).toHaveClass("service-tile__icon");
    expect(header?.children[1]).toHaveClass("service-tile__name");
  });

  // The header row sits under the absolutely-positioned top-right corner
  // controls, so it has to declare which one is there for globals.css to
  // reserve the matching inset (--tile-corner-reach). jsdom applies no
  // stylesheet, so the flag itself is what's assertable here.
  describe("header corner-control clearance", () => {
    const cornerSlot = (container: HTMLElement) =>
      container
        .querySelector(".service-tile__header")
        ?.getAttribute("data-corner-slot");

    it("flags the status dot's slot on a tile with a URL", async () => {
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(
          <ServiceTile name="Jellyfin" url="http://192.168.1.10:8096" />
        ));
      });
      expect(container.querySelector(".status-dot")).not.toBeNull();
      expect(cornerSlot(container)).toBe("dot");
    });

    it("flags the wider badge slot when the widget config is invalid", async () => {
      const issues: WidgetConfigIssue[] = [
        { path: "api_key", message: "Required" },
      ];
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(
          <ServiceTile
            name="Sonarr"
            url="http://sonarr.local"
            widget={{ type: "sonarr-queue", invalid: issues }}
          />
        ));
      });
      expect(container.querySelector(".tile-widget-badge")).not.toBeNull();
      expect(cornerSlot(container)).toBe("badge");
    });

    it("omits the flag when neither corner control renders", async () => {
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(<ServiceTile name="System Stats" />));
      });
      expect(container.querySelector(".status-dot")).toBeNull();
      expect(container.querySelector(".tile-widget-badge")).toBeNull();
      expect(cornerSlot(container)).toBeNull();
    });
  });

  it("links to the correct URL in a new tab", async () => {
    await act(async () => {
      render(<ServiceTile name="Jellyfin" url="http://192.168.1.10:8096" />);
    });
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "http://192.168.1.10:8096");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders the description when provided", async () => {
    await act(async () => {
    registerWidget({
      id: "description-test-widget",
      name: "Description test",
      configSchema: z.object({}),
      fetchData: async () => ({}),
      component: () => null,
      supportedFootprints: [{ columnSpan: 3, rowSpan: 2 }],
    });
      render(
        <ServiceTile
          name="Jellyfin"
          footprint={{ columnSpan: 3, rowSpan: 2 }}
          url="http://192.168.1.10:8096"
          widget={{ type: "description-test-widget" }}
          description="Media server"
        />
      );
    });
    expect(screen.getByText("Media server")).toBeInTheDocument();
  });

  it("does not render description when not provided", async () => {
    await act(async () => {
      render(<ServiceTile name="Jellyfin" url="http://192.168.1.10:8096" />);
    });
    expect(screen.queryByText(/media/i)).not.toBeInTheDocument();
  });

  it("hides descriptions in generic one-row footprints", async () => {
    await act(async () => {
      render(
        <ServiceTile
          name="Jellyfin"
          url="http://192.168.1.10:8096"
          description="Compact tile description"
          footprint={{ columnSpan: 3, rowSpan: 1 }}
        />
      );
    });

    expect(screen.queryByText("Compact tile description")).not.toBeInTheDocument();

  });
  it("falls back to a widget-supported footprint and previews it on mobile", async () => {
    registerWidget({
      id: "footprint-test-widget",
      name: "Footprint test",
      configSchema: z.object({}),
      fetchData: async () => ({}),
      component: () => null,
      supportedFootprints: [{ columnSpan: 6, rowSpan: 2 }],
      mobile: {
        footprint: { columnSpan: 3, rowSpan: 1 },
        component: () => null,
      },
    });
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile
          tileId="tile-id"
          name="Plex"
          url="http://plex.local"
          widget={{ type: "footprint-test-widget" }}
          footprint={{ columnSpan: 3, rowSpan: 1 }}
          preview
        />
      ));
    });
    expect(container.querySelector("a")?.style.getPropertyValue("--tile-columns")).toBe("6");

    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    await act(async () => {
      ({ container } = render(
        <ServiceTile tileId="tile-id" name="Plex" widget={{ type: "footprint-test-widget" }} preview />
      ));
    });
    expect(container.querySelector(".service-tile__widget-preview")).not.toBeNull();
    expect(container.querySelector(".service-tile--mobile-row-1")).not.toBeNull();
  });

  it("renders the icon prop as an img", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile
          name="Jellyfin"
          url="http://192.168.1.10:8096"
          icon="/icons/jellyfin.png"
        />
      ));
    });
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "/icons/jellyfin.png");
  });

  it("resolves a shorthand icon ref to its CDN URL", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile name="Jellyfin" url="http://192.168.1.10:8096" icon="di-jellyfin" />
      ));
    });
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/jellyfin.svg"
    );
  });

  it("falls back to favicon URL when no icon prop is given", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile name="Portainer" url="http://192.168.1.10:9000" />
      ));
    });
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "http://192.168.1.10:9000/favicon.ico");
  });

  it("falls back to letter avatar when both icon and favicon fail", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile
          name="Portainer"
          url="http://192.168.1.10:9000"
          icon="/bad-icon.png"
        />
      ));
    });

    // Trigger icon error → should now show favicon img
    await act(async () => {
      fireEvent.error(container.querySelector("img")!);
    });

    // Trigger favicon error → should now show letter fallback
    await act(async () => {
      fireEvent.error(container.querySelector("img")!);
    });

    expect(screen.getByText("P")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("status dot shows ok after ping resolves", async () => {
    await act(async () => {
      render(<ServiceTile name="Jellyfin" url="http://192.168.1.10:8096" />);
    });
    // act() flushes effects and the initial fetch promise
    expect(screen.getByTitle("Online")).toHaveClass("status-dot--ok");
  });

  it("status dot shows error when ping returns ok:false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: false }),
      } as Response)
    );

    await act(async () => {
      render(<ServiceTile name="Jellyfin" url="http://192.168.1.10:8096" />);
    });

    expect(screen.getByTitle("Offline")).toHaveClass("status-dot--error");
  });

  it("renders as a div (not a link) when url is omitted", async () => {
    await act(async () => {
      render(<ServiceTile name="System Stats" />);
    });
    expect(screen.getByText("System Stats")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("defaults to the service-tile--normal size variant", async () => {
    await act(async () => {
      render(<ServiceTile name="Jellyfin" url="http://192.168.1.10:8096" />);
    });
    const link = screen.getByRole("link");
    expect(link).toHaveClass("service-tile");
    expect(link).toHaveClass("service-tile--normal");
  });

  it.each(["normal", "wide", "tall", "large"] as const)(
    "applies the size variant class for size=%s",
    async (size) => {
      await act(async () => {
        render(
          <ServiceTile name="Jellyfin" url="http://192.168.1.10:8096" size={size} />
        );
      });
      expect(screen.getByRole("link")).toHaveClass(`service-tile--${size}`);
    }
  );

  it("preview mode suppresses status ping polling", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    } as Response);
    vi.stubGlobal("fetch", mockFetch);

    await act(async () => {
      render(
        <ServiceTile name="Jellyfin" url="http://192.168.1.10:8096" preview />
      );
    });
    // No probe on mount…
    expect(mockFetch).not.toHaveBeenCalled();
    // …and none after the interval window either.
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(mockFetch).not.toHaveBeenCalled();
    // Status dot still renders (static pending), root classes unchanged.
    expect(screen.getByRole("link")).toHaveClass("service-tile");
  });

  it("preview mode renders a static widget placeholder instead of polling the widget", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    } as Response);
    vi.stubGlobal("fetch", mockFetch);

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile
          name="Sonarr"
          url="http://192.168.1.10:8989"
          widget={{ type: "sonarr-queue" }}
          preview
        />
      ));
    });
    const widget = container.querySelector(".service-tile__widget");
    expect(widget).not.toBeNull();
    expect(widget).toHaveAttribute("data-widget-type", "sonarr-queue");
    expect(
      container.querySelector(".service-tile__widget-preview")
    ).not.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("polls ping again after 30 seconds", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    } as Response);
    vi.stubGlobal("fetch", mockFetch);

    await act(async () => {
      render(<ServiceTile name="Jellyfin" url="http://192.168.1.10:8096" />);
    });
    // Initial call on mount
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance 30 seconds to trigger the interval
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("ServiceTile broken-widget badge", () => {
  const issues: WidgetConfigIssue[] = [
    { path: "api_key", message: "Required" },
    { path: "url", message: "Invalid url" },
  ];

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true }),
      } as Response)
    );
    editModeOptional.current = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    editModeOptional.current = null;
  });

  it("renders the badge (not the widget body) when widget.invalid is set", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile
          name="Sonarr"
          url="http://sonarr.local"
          widget={{ type: "sonarr-queue", invalid: issues }}
        />
      ));
    });
    const badge = container.querySelector(".tile-widget-badge");
    expect(badge).not.toBeNull();
    expect(badge).toHaveAttribute("data-widget-config-invalid", "true");
    expect(badge).toHaveAttribute(
      "aria-label",
      "Widget configuration error: Sonarr"
    );
    expect(badge).toHaveAttribute(
      "title",
      "api_key: Required\nurl: Invalid url"
    );
    expect(container.querySelector(".service-tile__widget")).toBeNull();
  });

  it("does not render a badge for a valid widget", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile
          name="Sonarr"
          url="http://sonarr.local"
          widget={{ type: "sonarr-queue" }}
          preview
        />
      ));
    });
    expect(container.querySelector(".tile-widget-badge")).toBeNull();
    expect(container.querySelector(".service-tile__widget")).not.toBeNull();
  });

  it("badge and status dot share one slot: an invalid config shows the badge and no status dot", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile
          name="Sonarr"
          url="http://sonarr.local"
          widget={{ type: "sonarr-queue", invalid: issues }}
        />
      ));
    });
    expect(container.querySelector(".tile-widget-badge")).not.toBeNull();
    expect(container.querySelector(".status-dot")).toBeNull();
  });

  it("badge and status dot share one slot: a valid config shows the status dot and no badge", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile
          name="Sonarr"
          url="http://sonarr.local"
          widget={{ type: "sonarr-queue" }}
        />
      ));
    });
    expect(container.querySelector(".status-dot")).not.toBeNull();
    expect(container.querySelector(".tile-widget-badge")).toBeNull();
  });

  it("renders the badge even when the tile has no url (and so no status dot slot to begin with)", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile name="Sonarr" widget={{ type: "sonarr-queue", invalid: issues }} />
      ));
    });
    expect(container.querySelector(".tile-widget-badge")).not.toBeNull();
    expect(container.querySelector(".status-dot")).toBeNull();
    // No url → renders as a div, not a link.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not render a badge when there is no widget at all", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile name="Jellyfin" url="http://jellyfin.local" />
      ));
    });
    expect(container.querySelector(".tile-widget-badge")).toBeNull();
  });

  it("is non-interactive (role=img, no tabIndex) with no edit-mode provider", async () => {
    editModeOptional.current = null;
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile
          name="Sonarr"
          url="http://sonarr.local"
          widget={{ type: "sonarr-queue", invalid: issues }}
        />
      ));
    });
    const badge = container.querySelector(".tile-widget-badge")!;
    expect(badge).toHaveAttribute("role", "img");
    expect(badge).not.toHaveAttribute("tabIndex");
    expect(badge).not.toHaveClass("tile-widget-badge--interactive");
  });

  it("is non-interactive when edit mode is available but canEdit is false", async () => {
    editModeOptional.current = { canEdit: false, requestServiceEdit: vi.fn() };
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile
          name="Sonarr"
          url="http://sonarr.local"
          widget={{ type: "sonarr-queue", invalid: issues }}
        />
      ));
    });
    const badge = container.querySelector(".tile-widget-badge")!;
    expect(badge).toHaveAttribute("role", "img");
    expect(badge).not.toHaveClass("tile-widget-badge--interactive");
  });

  it("is interactive (role=button, tabIndex 0) when edit mode is available and canEdit", async () => {
    editModeOptional.current = { canEdit: true, requestServiceEdit: vi.fn() };
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile
          name="Sonarr"
          url="http://sonarr.local"
          widget={{ type: "sonarr-queue", invalid: issues }}
        />
      ));
    });
    const badge = container.querySelector(".tile-widget-badge")!;
    expect(badge).toHaveAttribute("role", "button");
    expect(badge).toHaveAttribute("tabIndex", "0");
    expect(badge).toHaveClass("tile-widget-badge--interactive");
  });

  it("clicking the interactive badge calls requestServiceEdit and prevents the link navigation", async () => {
    const requestServiceEdit = vi.fn();
    editModeOptional.current = { canEdit: true, requestServiceEdit };
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile
          name="Sonarr"
          url="http://sonarr.local"
          widget={{ type: "sonarr-queue", invalid: issues }}
        />
      ));
    });
    const link = container.querySelector("a.service-tile")!;
    let capturedEvent: Event | null = null;
    // Capture phase fires (top-down) before the badge's own bubble-phase
    // onClick runs, but it's the same event object throughout, so by the time
    // the synchronous dispatch finishes, `defaultPrevented` reflects whatever
    // the badge's handler did.
    link.addEventListener("click", (e) => (capturedEvent = e), true);

    const badge = container.querySelector(".tile-widget-badge")!;
    fireEvent.click(badge);

    expect(requestServiceEdit).toHaveBeenCalledWith("Sonarr");
    expect(requestServiceEdit).toHaveBeenCalledTimes(1);
    expect(capturedEvent).not.toBeNull();
    expect((capturedEvent as unknown as Event).defaultPrevented).toBe(true);
  });

  it("clicking the interactive badge does not bubble the click to an ancestor handler", async () => {
    const requestServiceEdit = vi.fn();
    editModeOptional.current = { canEdit: true, requestServiceEdit };
    const parentClick = vi.fn();
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <div onClick={parentClick}>
          <ServiceTile
            name="Sonarr"
            url="http://sonarr.local"
            widget={{ type: "sonarr-queue", invalid: issues }}
          />
        </div>
      ));
    });
    const badge = container.querySelector(".tile-widget-badge")!;
    fireEvent.click(badge);
    expect(requestServiceEdit).toHaveBeenCalledTimes(1);
    // e.stopPropagation() in the badge's onClick must stop it here — a
    // regression would let the click fall through to the grid/tile ancestor
    // (e.g. starting a drag, or a future ancestor click handler) on top of
    // opening the editor.
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("Enter and Space on the interactive badge call requestServiceEdit", async () => {
    const requestServiceEdit = vi.fn();
    editModeOptional.current = { canEdit: true, requestServiceEdit };
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile
          name="Sonarr"
          url="http://sonarr.local"
          widget={{ type: "sonarr-queue", invalid: issues }}
        />
      ));
    });
    const badge = container.querySelector(".tile-widget-badge")!;

    fireEvent.keyDown(badge, { key: "Enter" });
    expect(requestServiceEdit).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(badge, { key: " " });
    expect(requestServiceEdit).toHaveBeenCalledTimes(2);

    // An unrelated key is a no-op.
    fireEvent.keyDown(badge, { key: "a" });
    expect(requestServiceEdit).toHaveBeenCalledTimes(2);
  });

  it("clicking the non-interactive badge does not throw and does not intercept the click", async () => {
    editModeOptional.current = null;
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <ServiceTile
          name="Sonarr"
          url="http://sonarr.local"
          widget={{ type: "sonarr-queue", invalid: issues }}
        />
      ));
    });
    const link = container.querySelector("a.service-tile")!;
    let capturedEvent: Event | null = null;
    link.addEventListener("click", (e) => (capturedEvent = e), true);

    const badge = container.querySelector(".tile-widget-badge")!;
    expect(() => fireEvent.click(badge)).not.toThrow();

    // Unlike the interactive badge (which calls preventDefault +
    // stopPropagation), the non-interactive one has no click handler at all —
    // the click bubbles straight through to the tile's anchor unimpeded, so
    // nothing here stops the link's default navigation.
    expect(capturedEvent).not.toBeNull();
    expect((capturedEvent as unknown as Event).defaultPrevented).toBe(false);
  });
});
