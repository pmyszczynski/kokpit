import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnraidStatsWidget } from "@/integrations/unraid/statsWidget";
import type { UnraidStats } from "@/integrations/unraid/api";

const noop = () => {};

const GiB = 1024 ** 3;

const SAMPLE_STATS: UnraidStats = {
  arrayState: "STARTED",
  totalBytes: 16 * GiB,
  usedBytes: 8 * GiB,
  diskCount: 4,
  diskErrors: 0,
  parityStatus: "STARTED",
  parityErrors: 0,
  parityDate: "2026-06-01",
};

describe("UnraidStatsWidget", () => {
  it("renders array state, capacity, disk count, and errors", () => {
    render(
      <UnraidStatsWidget data={SAMPLE_STATS} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getAllByText("Started").length).toBe(2); // array state + parity status
    expect(screen.getByText("8.0 GiB")).toBeInTheDocument();
    expect(screen.getByText(/16\.0 GiB/)).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Disks")).toBeInTheDocument();
  });

  it("formats arrayState by title-casing and replacing underscores", () => {
    render(
      <UnraidStatsWidget
        data={{ ...SAMPLE_STATS, arrayState: "STOPPED_INVALID" }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("Stopped Invalid")).toBeInTheDocument();
  });

  it("computes and displays usedPct in the label", () => {
    render(
      <UnraidStatsWidget
        data={{ ...SAMPLE_STATS, totalBytes: 100, usedBytes: 25 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText(/Used \(25%\)/)).toBeInTheDocument();
  });

  it("does not add error class when diskErrors is 0", () => {
    render(
      <UnraidStatsWidget
        data={{ ...SAMPLE_STATS, diskErrors: 0 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    const errorValues = screen.getAllByText("0");
    const diskErrorValue = errorValues.find((el) =>
      el.className.includes("unraid-stats-widget__value")
    );
    expect(diskErrorValue?.className).not.toContain("unraid-stats-widget__value--error");
  });

  it("adds error class and shows count when diskErrors > 0", () => {
    render(
      <UnraidStatsWidget
        data={{ ...SAMPLE_STATS, diskErrors: 2 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    const errorValue = screen.getByText("2");
    expect(errorValue.className).toContain("unraid-stats-widget__value--error");
    expect(screen.getByText("Errors")).toBeInTheDocument();
  });

  it("renders the parity block when parityStatus is not null", () => {
    render(
      <UnraidStatsWidget data={SAMPLE_STATS} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getAllByText("Started").length).toBe(2); // array state + parity status
    expect(screen.getByText(/Parity/)).toBeInTheDocument();
    expect(screen.getByText(/2026-06-01/)).toBeInTheDocument();
  });

  it("does not render the parity block when parityStatus is null", () => {
    render(
      <UnraidStatsWidget
        data={{ ...SAMPLE_STATS, parityStatus: null }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.queryByText(/Parity/)).not.toBeInTheDocument();
  });

  it("formats parityStatus === '' as 'OK'", () => {
    render(
      <UnraidStatsWidget
        data={{ ...SAMPLE_STATS, parityStatus: "" }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getAllByText("OK").length).toBeGreaterThan(0);
  });

  it("shows parity error count as '(N err)' when parityErrors > 0", () => {
    render(
      <UnraidStatsWidget
        data={{ ...SAMPLE_STATS, parityErrors: 3 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText(/\(3 err\)/)).toBeInTheDocument();
  });

  it("does not show parity error count when parityErrors is 0", () => {
    render(
      <UnraidStatsWidget
        data={{ ...SAMPLE_STATS, parityErrors: 0 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.queryByText(/err\)/)).not.toBeInTheDocument();
  });

  it("shows loading hint when data is null and loading", () => {
    render(<UnraidStatsWidget data={null} loading={true} error={null} refresh={noop} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <UnraidStatsWidget
        data={null}
        loading={false}
        error="Unraid responded with 401"
        refresh={noop}
      />
    );
    expect(screen.getByText("Unraid responded with 401")).toBeInTheDocument();
  });

  it("shows stale error alongside data when data is non-null and error is set", () => {
    render(
      <UnraidStatsWidget
        data={SAMPLE_STATS}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("Disks")).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("refresh failed");
  });

  it("renders --empty container when data is null and neither loading nor error", () => {
    const { container } = render(
      <UnraidStatsWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(container.querySelector(".unraid-stats-widget--empty")).toBeInTheDocument();
    expect(screen.queryByText("Disks")).not.toBeInTheDocument();
  });
});
