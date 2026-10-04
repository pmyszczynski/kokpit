import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SeerrStatsWidget } from "@/integrations/seerr/statsWidget";

const noop = () => {};

const SAMPLE_DATA = {
  pending: 3,
  approved: 7,
  available: 42,
  total: 52,
};

describe("SeerrStatsWidget component", () => {
  it("renders all stats with correct values and labels", () => {
    render(
      <SeerrStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} footprint={{ columnSpan: 3, rowSpan: 4 }} />
    );
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("52")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("shows loading hint when data is null and loading", () => {
    render(
      <SeerrStatsWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByRole("status", { name: "Loading widget" })).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <SeerrStatsWidget
        data={null}
        loading={false}
        error="Seerr responded with 401"
        refresh={noop}
      />
    );
    expect(screen.getByText("Seerr responded with 401")).toBeInTheDocument();
  });

  it("shows stale error alongside data when data is non-null and error is set", () => {
    render(
      <SeerrStatsWidget
        data={SAMPLE_DATA}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("3")).toBeInTheDocument();
    const errorEl = screen.getByRole("alert");
    expect(errorEl).toHaveAccessibleName("Refresh failed; saved data is shown. refresh failed");
  });

  it("renders nothing meaningful when data is null and neither loading nor error", () => {
    const { container } = render(
      <SeerrStatsWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(
      container.querySelector(".seerr-stats-widget--empty")
    ).toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
  });
});

describe("Seerr shared composition", () => {
  it.each([
    [3, 2, ["Pending", "Available"]],
    [6, 2, ["Pending", "Available", "Total"]],
    [3, 4, ["Pending", "Approved", "Available", "Total"]],
  ] as const)("selects existing metrics at %sx%s", (columnSpan, rowSpan, labels) => {
    const { container } = render(<SeerrStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} footprint={{ columnSpan, rowSpan }} />);
    expect(Array.from(container.querySelectorAll("dt")).map(node => node.textContent)).toEqual(labels);
  });
  it("keeps zero pending and available neutral but categories informational", () => {
    const { container } = render(<SeerrStatsWidget data={{pending:0,approved:0,available:0,total:0}} loading={false} error={null} refresh={noop} footprint={{columnSpan:3,rowSpan:4}} />);
    for (const key of ["pending", "available"]) expect(container.querySelector(`.seerr-stats-widget__stat--${key}`)).toHaveClass("widget-stat--tone-neutral");
    for (const key of ["approved", "total"]) expect(container.querySelector(`.seerr-stats-widget__stat--${key}`)).toHaveClass("widget-stat--tone-info");
  });
});
