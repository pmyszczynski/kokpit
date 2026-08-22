import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlexWidget } from "@/integrations/plex/widget";
import { getWidget } from "@/widgets";

const noop = () => {};

describe("PlexWidget component", () => {
  it("renders streams and transcodes with correct values and labels", () => {
    render(
      <PlexWidget
        data={{ streams: 3, transcodes: 1 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Streaming")).toBeInTheDocument();
    expect(screen.getByText("Transcoding")).toBeInTheDocument();
  });

  it("renders only the fields present in data", () => {
    render(
      <PlexWidget
        data={{ library_movies: 150, library_shows: 40 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("150")).toBeInTheDocument();
    expect(screen.getByText("Movies")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("Shows")).toBeInTheDocument();
    expect(screen.queryByText("Streaming")).not.toBeInTheDocument();
  });

  it("formats bandwidth as Mbps", () => {
    render(
      <PlexWidget
        data={{ bandwidth: 45000 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("45.0 Mbps")).toBeInTheDocument();
    expect(screen.getByText("Bandwidth")).toBeInTheDocument();
    expect(screen.getByText("45.0 Mbps")).toHaveClass(
      "plex-widget__value--bandwidth"
    );
    expect(screen.getByText("Bandwidth").closest(".plex-widget__stat"))
      .toHaveAttribute("data-field", "bandwidth");
  });

  it.each([
    [4_500_000, "4.5 Gbps"],
    [999_999, "1.0 Gbps"],
    [999_999_999, "1.0 Tbps"],
  ])("uses a compact unit for %d Kbps", (bandwidth, expected) => {
    render(
      <PlexWidget data={{ bandwidth }} loading={false}
        error={null} refresh={noop} />
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("exposes its active footprint to the layout", () => {
    render(
      <PlexWidget data={{ streams: 3 }} loading={false} error={null}
        refresh={noop} footprint={{ columnSpan: 3, rowSpan: 4 }} />
    );
    expect(screen.getByLabelText("Plex stats"))
      .toHaveAttribute("data-footprint", "3x4");
  });

  it("declares default, narrow, and expanded canvases", () => {
    expect(getWidget("plex")?.supportedFootprints).toEqual([
      { label: "Default", columnSpan: 6, rowSpan: 2 },
      { label: "Narrow", columnSpan: 3, rowSpan: 4 },
      { label: "Expanded", columnSpan: 6, rowSpan: 4 },
    ]);
  });

  it("shows loading hint when data is null and loading", () => {
    render(
      <PlexWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <PlexWidget
        data={null}
        loading={false}
        error="Plex responded with 401"
        refresh={noop}
      />
    );
    expect(screen.getByText("Plex responded with 401")).toBeInTheDocument();
  });

  it("shows stale error alongside data when data is non-null and error is set", () => {
    render(
      <PlexWidget
        data={{ streams: 2, transcodes: 0 }}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
  });

  it("renders zero values correctly", () => {
    render(
      <PlexWidget
        data={{ streams: 0, transcodes: 0 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    const zeros = screen.getAllByText("0");
    expect(zeros).toHaveLength(2);
  });

  it("renders nothing meaningful when data is null and neither loading nor error", () => {
    const { container } = render(
      <PlexWidget data={null} loading={false} error={null} refresh={noop} />
    );
    // Should render the empty container but no stat values
    expect(container.querySelector(".plex-widget--empty")).toBeInTheDocument();
    expect(screen.queryByText("Streaming")).not.toBeInTheDocument();
  });
});
