import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TdarrStatsWidget } from "@/integrations/tdarr/statsWidget";
import type { TdarrStats } from "@/integrations/tdarr/api";

const noop = () => {};

const SAMPLE_DATA: TdarrStats = {
  transcodeQueue: 10,
  healthCheckQueue: 5,
  transcoded: 480,
  errored: 3,
  spaceSavedGb: 1.2,
  totalFiles: 1000,
  activeWorkers: 4,
  fps: 65.8,
};

describe("TdarrStatsWidget", () => {
  it("shows loading hint when data is null and loading", () => {
    render(<TdarrStatsWidget footprint={{ columnSpan: 3, rowSpan: 4 }} data={null} loading={true} error={null} refresh={noop} />);
    expect(screen.getByRole("status", { name: "Loading widget" })).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <TdarrStatsWidget footprint={{ columnSpan: 3, rowSpan: 4 }} data={null} loading={false} error="connection refused" refresh={noop} />
    );
    expect(screen.getByText("connection refused")).toBeInTheDocument();
  });

  it("renders the empty container class when data is null", () => {
    const { container } = render(
      <TdarrStatsWidget footprint={{ columnSpan: 3, rowSpan: 4 }} data={null} loading={false} error={null} refresh={noop} />
    );
    expect(container.querySelector(".tdarr-stats-widget--empty")).toBeInTheDocument();
  });

  it("renders the transcode queue and label", () => {
    render(<TdarrStatsWidget footprint={{ columnSpan: 3, rowSpan: 4 }} data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />);
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Transcode Queue")).toBeInTheDocument();
  });

  it("renders health checks and errored counts", () => {
    render(<TdarrStatsWidget footprint={{ columnSpan: 3, rowSpan: 4 }} data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />);
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Health Checks")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Errored")).toBeInTheDocument();
  });

  it("renders workers and formatted fps", () => {
    render(<TdarrStatsWidget footprint={{ columnSpan: 3, rowSpan: 4 }} data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />);
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Workers")).toBeInTheDocument();
    expect(screen.getByText("65.8")).toBeInTheDocument();
    expect(screen.getByText("FPS")).toBeInTheDocument();
  });

  it("renders formatted space saved", () => {
    render(<TdarrStatsWidget footprint={{ columnSpan: 3, rowSpan: 4 }} data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />);
    // 1.2 GB in Tdarr terms -> 1.2e9 bytes -> formatBytes renders "1.2 GB"
    expect(screen.getByText("1.2 GB")).toBeInTheDocument();
    expect(screen.getByText("Space Saved")).toBeInTheDocument();
  });

  it("renders multi-terabyte space saved with a TB unit", () => {
    // A busy Tdarr install can save tens of TB; sizeDiff is reported in GB.
    render(
      <TdarrStatsWidget footprint={{ columnSpan: 3, rowSpan: 4 }}
        data={{ ...SAMPLE_DATA, spaceSavedGb: 45_000 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("45.0 TB")).toBeInTheDocument();
  });

  it("shows stale error alongside data when data is non-null and error is set", () => {
    render(
      <TdarrStatsWidget footprint={{ columnSpan: 3, rowSpan: 4 }} data={SAMPLE_DATA} loading={false} error="refresh failed" refresh={noop} />
    );
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveAccessibleName("Refresh failed; saved data is shown. refresh failed");
  });
});


describe("Tdarr size-specific summaries", () => {
  it.each([
    { columnSpan: 3, rowSpan: 2, labels: ["Transcode Queue", "Workers"] },
    { columnSpan: 6, rowSpan: 2, labels: ["Transcode Queue", "Workers", "Space Saved"] },
    { columnSpan: 3, rowSpan: 4, labels: ["Transcode Queue", "Health Checks", "Errored", "Space Saved", "Workers", "FPS"] },
  ])("shows the intended stats for $columnSpan x $rowSpan", ({ columnSpan, rowSpan, labels }) => {
    const { container } = render(<TdarrStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} footprint={{ columnSpan, rowSpan }} />);
    expect(Array.from(container.querySelectorAll(".widget-stat__label"), (element) => element.textContent)).toEqual(labels);
    expect(container.querySelector(".widget-body__notice")).toBeEmptyDOMElement();
  });

  it("uses semantic colors without marking zero queue/errors or absent worker data as healthy", () => {
    const { container, rerender } = render(<TdarrStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} footprint={{ columnSpan: 3, rowSpan: 4 }} />);
    const tones = () => Array.from(container.querySelectorAll(".widget-stat"), (element) => element.className.match(/widget-stat--tone-(\S+)/)?.[1]);
    expect(tones()).toEqual(["warning", "warning", "alert", "positive", "positive", "info"]);
    rerender(<TdarrStatsWidget data={{ ...SAMPLE_DATA, transcodeQueue: 0, healthCheckQueue: 0, errored: 0, spaceSavedGb: 0, activeWorkers: 0, fps: 0 }} loading={false} error={null} refresh={noop} footprint={{ columnSpan: 3, rowSpan: 4 }} />);
    expect(tones()).toEqual(Array(6).fill("neutral"));
    expect(screen.getByText("0.0")).toBeInTheDocument();
    expect(screen.getByText("0 B")).toBeInTheDocument();
  });

  it.each([
    { spaceSavedGb: -0.000000012, formatted: "-12 B" },
    { spaceSavedGb: -0.000002, formatted: "-2.0 KB" },
    { spaceSavedGb: -0.002, formatted: "-2.0 MB" },
    { spaceSavedGb: -1, formatted: "-1.0 GB" },
    { spaceSavedGb: -45000, formatted: "-45.0 TB" },
  ])("keeps signed savings readable as $formatted without assigning a positive tone", ({ spaceSavedGb, formatted }) => {
    const { container } = render(<TdarrStatsWidget data={{ ...SAMPLE_DATA, spaceSavedGb }} loading={false} error={null} refresh={noop} footprint={{ columnSpan: 3, rowSpan: 4 }} />);
    expect(screen.getByText(formatted)).toBeInTheDocument();
    expect(container.querySelector(".tdarr-stats-widget__stat--spaceSavedGb")).toHaveClass("widget-stat--tone-neutral");
  });

  it("uses the wide summary for direct renders without a footprint", () => {
    const { container } = render(<TdarrStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />);
    expect(container.querySelector(".tdarr-stats-widget")).toHaveAttribute("data-footprint", "6x2");
    expect(container.querySelectorAll(".widget-stat")).toHaveLength(3);
  });
});
