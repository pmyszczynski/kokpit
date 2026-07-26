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
    render(<TdarrStatsWidget data={null} loading={true} error={null} refresh={noop} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <TdarrStatsWidget data={null} loading={false} error="connection refused" refresh={noop} />
    );
    expect(screen.getByText("connection refused")).toBeInTheDocument();
  });

  it("renders the empty container class when data is null", () => {
    const { container } = render(
      <TdarrStatsWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(container.querySelector(".tdarr-stats-widget--empty")).toBeInTheDocument();
  });

  it("renders the transcode queue and label", () => {
    render(<TdarrStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />);
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Transcode Queue")).toBeInTheDocument();
  });

  it("renders health checks and errored counts", () => {
    render(<TdarrStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />);
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Health Checks")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Errored")).toBeInTheDocument();
  });

  it("renders workers and formatted fps", () => {
    render(<TdarrStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />);
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Workers")).toBeInTheDocument();
    expect(screen.getByText("65.8")).toBeInTheDocument();
    expect(screen.getByText("FPS")).toBeInTheDocument();
  });

  it("renders formatted space saved", () => {
    render(<TdarrStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />);
    // 1.2 GB in Tdarr terms -> 1.2e9 bytes -> formatBytes renders "1.2 GB"
    expect(screen.getByText("1.2 GB")).toBeInTheDocument();
    expect(screen.getByText("Space Saved")).toBeInTheDocument();
  });

  it("renders multi-terabyte space saved with a TB unit", () => {
    // A busy Tdarr install can save tens of TB; sizeDiff is reported in GB.
    render(
      <TdarrStatsWidget
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
      <TdarrStatsWidget data={SAMPLE_DATA} loading={false} error="refresh failed" refresh={noop} />
    );
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
  });
});
