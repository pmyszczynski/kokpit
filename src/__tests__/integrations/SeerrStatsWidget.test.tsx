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
      <SeerrStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
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
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
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
    expect(errorEl).toHaveTextContent("refresh failed");
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
