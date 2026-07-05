import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProwlarrStatsWidget } from "@/integrations/prowlarr/statsWidget";
import type { ProwlarrStats } from "@/integrations/prowlarr/api";

const noop = () => {};

const SAMPLE_STATS: ProwlarrStats = {
  totalIndexers: 12,
  enabledIndexers: 10,
  failingIndexers: 0,
  totalGrabs: 1234,
};

describe("ProwlarrStatsWidget", () => {
  it("renders all 4 stats with correct values and labels", () => {
    render(
      <ProwlarrStatsWidget data={SAMPLE_STATS} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Indexers")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("Failing")).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("Total Grabs")).toBeInTheDocument();
  });

  it("formats totalGrabs with toLocaleString separators", () => {
    render(
      <ProwlarrStatsWidget
        data={{ ...SAMPLE_STATS, totalGrabs: 1_000_000 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("1,000,000")).toBeInTheDocument();
  });

  it("does not add the alert class when failingIndexers is 0", () => {
    render(
      <ProwlarrStatsWidget
        data={{ ...SAMPLE_STATS, failingIndexers: 0 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    const failingValue = screen.getByText("0");
    expect(failingValue.className).not.toContain("prowlarr-stats-widget__value--alert");
  });

  it("adds the alert class when failingIndexers > 0", () => {
    render(
      <ProwlarrStatsWidget
        data={{ ...SAMPLE_STATS, failingIndexers: 3 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    const failingValue = screen.getByText("3");
    expect(failingValue.className).toContain("prowlarr-stats-widget__value--alert");
  });

  it("shows loading hint when data is null and loading", () => {
    render(
      <ProwlarrStatsWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <ProwlarrStatsWidget
        data={null}
        loading={false}
        error="Prowlarr responded with 401"
        refresh={noop}
      />
    );
    expect(screen.getByText("Prowlarr responded with 401")).toBeInTheDocument();
  });

  it("shows stale error alongside data when data is non-null and error is set", () => {
    render(
      <ProwlarrStatsWidget
        data={SAMPLE_STATS}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("12")).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("refresh failed");
  });

  it("renders --empty container when data is null and neither loading nor error", () => {
    const { container } = render(
      <ProwlarrStatsWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(
      container.querySelector(".prowlarr-stats-widget--empty")
    ).toBeInTheDocument();
    expect(screen.queryByText("Indexers")).not.toBeInTheDocument();
  });
});
