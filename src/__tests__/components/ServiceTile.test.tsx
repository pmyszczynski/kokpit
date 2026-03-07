import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ServiceTile from "@/components/ServiceTile";

describe("ServiceTile", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true, status: 200 }),
      } as Response)
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders the service name", async () => {
    await act(async () => {
      render(<ServiceTile name="Jellyfin" url="http://192.168.1.10:8096" />);
    });
    expect(screen.getByText("Jellyfin")).toBeInTheDocument();
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
      render(
        <ServiceTile
          name="Jellyfin"
          url="http://192.168.1.10:8096"
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
