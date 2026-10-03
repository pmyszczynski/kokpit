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
  usenetIndexers: 8,
  torrentIndexers: 4,
};

describe("ProwlarrStatsWidget", () => {
  it("renders all 6 stats with correct values and labels", () => {
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
    expect(screen.getByText("Usenet").closest("dl")).toHaveTextContent("8");
    expect(screen.getByText("Torrent").closest("dl")).toHaveTextContent("4");
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
    expect(failingValue.closest(".widget-stat")).toHaveClass("widget-stat--tone-neutral");
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
    expect(failingValue.closest(".widget-stat")).toHaveClass("widget-stat--tone-alert");
  });

  it("shows loading hint when data is null and loading", () => {
    render(
      <ProwlarrStatsWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByRole("status", { name: "Loading widget" })).toHaveClass("widget-state--loading");
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
    expect(screen.getByRole("alert")).toHaveTextContent("Prowlarr responded with 401");
    expect(screen.getByRole("alert")).toHaveClass("widget-state--error");
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
    expect(alert).toHaveTextContent("Refresh failed · saved data");
    expect(alert).toHaveAccessibleName("Refresh failed; saved data is shown. refresh failed");
    expect(alert).toHaveAttribute("title", "refresh failed");
  });

  it("renders --empty container when data is null and neither loading nor error", () => {
    const { container } = render(
      <ProwlarrStatsWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(
      container.querySelector(".prowlarr-stats-widget--empty")
    ).toBeInTheDocument();
    expect(screen.queryByText("Indexers")).not.toBeInTheDocument();
    expect(container.querySelector(".prowlarr-stats-widget--empty")).toBeEmptyDOMElement();
  });

  it("retains a separate notice slot through refresh failure and recovery", () => {
    const { container, rerender } = render(
      <ProwlarrStatsWidget data={SAMPLE_STATS} loading={false} error={null} refresh={noop} />
    );
    const notice = container.querySelector(".widget-body__notice")!;
    const grid = container.querySelector(".widget-stat-grid")!;
    expect(notice).toBeEmptyDOMElement();
    expect(grid.nextElementSibling).toBe(notice);

    rerender(<ProwlarrStatsWidget data={SAMPLE_STATS} loading={false} error="Timeout" refresh={noop} />);
    expect(notice).toContainElement(screen.getByRole("alert"));
    expect(grid.querySelectorAll(".widget-stat")).toHaveLength(6);

    rerender(<ProwlarrStatsWidget data={SAMPLE_STATS} loading={false} error={null} refresh={noop} />);
    expect(container.querySelector(".widget-body__notice")).toBe(notice);
    expect(notice).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
