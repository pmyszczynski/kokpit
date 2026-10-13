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
  it.each([
    [{ columnSpan: 3, rowSpan: 2 }, ["array", "used"]],
    [{ columnSpan: 6, rowSpan: 2 }, ["array", "used", "errors"]],
    [{ columnSpan: 3, rowSpan: 4 }, ["array", "used", "disks", "errors", "parity", "parityErrors"]],
    [{ columnSpan: 6, rowSpan: 4 }, ["array", "used", "disks", "errors", "parity", "parityErrors"]],
  ] as const)("selects the measurements for %o", (footprint, fields) => {
    const { container } = render(<UnraidStatsWidget data={SAMPLE_STATS} footprint={footprint} loading={false} error={null} refresh={noop} />);
    expect(Array.from(container.querySelectorAll(".widget-stat")).map(card => card.getAttribute("data-field"))).toEqual(fields);
    expect(screen.getByText("/ 16.0 GiB")).toHaveClass("widget-stat__supporting-value");
  });

  it("keeps compact array health problems visible even without separate error cards", () => {
    const { container } = render(<UnraidStatsWidget data={{ ...SAMPLE_STATS, diskErrors: 2, parityErrors: 3 }}
      footprint={{ columnSpan: 3, rowSpan: 2 }} loading={false} error={null} refresh={noop} />);
    expect(container.querySelector('[data-field="array"]')).toHaveClass("widget-stat--tone-alert");
    expect(screen.getByText("Needs attention")).toHaveClass("widget-stat__label");
    expect(container.querySelector('[data-field="array"] .widget-stat__value')).toHaveAccessibleDescription("Array: Started; disk errors: 2; parity errors: 3");
  });

  it("keeps missing parity measurements neutral and distinct from zero errors", () => {
    const { container } = render(<UnraidStatsWidget data={{ ...SAMPLE_STATS, parityStatus: null, parityErrors: null, parityDate: null }}
      loading={false} error={null} refresh={noop} />);
    for (const key of ["parity", "parityErrors"]) {
      expect(container.querySelector(`[data-field="${key}"]`)).toHaveClass("widget-stat--tone-neutral");
      expect(container.querySelector(`[data-field="${key}"] .widget-stat__value`)).toHaveTextContent("—");
    }
  });

  it.each([["STARTED", "positive"], ["STOPPED", "neutral"], ["STOPPED_INVALID", "alert"], ["UNKNOWN_STATE", "neutral"]])(
    "maps array state %s without inventing health meanings", (arrayState, tone) => {
      const { container } = render(<UnraidStatsWidget data={{ ...SAMPLE_STATS, arrayState }} loading={false} error={null} refresh={noop} />);
      expect(container.querySelector('[data-field="array"]')).toHaveClass(`widget-stat--tone-${tone}`);
      expect(container.querySelector('[data-field="used"]')).toHaveClass("widget-stat--tone-info");
      expect(container.querySelector('[data-field="errors"]')).toHaveClass("widget-stat--tone-neutral");
    });
  it("renders array state, capacity, disk count, and errors", () => {
    render(
      <UnraidStatsWidget data={SAMPLE_STATS} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getAllByText("Started").length).toBe(2); // array state + parity status
    expect(screen.getByText("8.0 GiB")).toBeInTheDocument();
    expect(screen.getByText("/ 16.0 GiB")).toBeInTheDocument();
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
    expect(screen.getByText("Parity")).toBeInTheDocument();
    expect(screen.getByText("2026-06-01")).toBeInTheDocument();
  });

  it("shows missing parity as unavailable rather than a healthy result", () => {
    const { container } = render(
      <UnraidStatsWidget
        data={{ ...SAMPLE_STATS, parityStatus: null }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    const parity = container.querySelector('[data-field="parity"]')!;
    expect(parity).toHaveClass("widget-stat--tone-neutral");
    expect(parity.querySelector(".widget-stat__value")).toHaveTextContent("—");
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

  it("shows positive parity errors in their own alert card", () => {
    const { container } = render(
      <UnraidStatsWidget
        data={{ ...SAMPLE_STATS, parityErrors: 3 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(container.querySelector('[data-field="parityErrors"]')).toHaveClass("widget-stat--tone-alert");
    expect(container.querySelector('[data-field="parityErrors"] .widget-stat__value')).toHaveTextContent("3");
    expect(container.querySelector('[data-field="array"]')).toHaveClass("widget-stat--tone-positive");
    expect(container.querySelector('[data-field="array"] .widget-stat__supporting-value')).toBeNull();
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
    expect(screen.getByRole("status", { name: "Loading widget" })).toBeInTheDocument();
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
    expect(alert).toHaveTextContent("Refresh failed · saved data");
    expect(alert).toHaveAccessibleName("Refresh failed; saved data is shown. refresh failed");
  });

  it("renders --empty container when data is null and neither loading nor error", () => {
    const { container } = render(
      <UnraidStatsWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(container.querySelector(".unraid-stats-widget--empty")).toBeInTheDocument();
    expect(screen.queryByText("Disks")).not.toBeInTheDocument();
  });
});
