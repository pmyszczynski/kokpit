import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QbittorrentStatsWidget, formatSpeed, formatBytes } from "@/integrations/qbittorrent/statsWidget";

describe("formatSpeed", () => {
  it("formats values below 1 MB/s as KB/s", () => {
    expect(formatSpeed(500_000)).toBe("500.0 KB/s");
  });

  it("formats values at exactly 1 MB/s as MB/s", () => {
    expect(formatSpeed(1_000_000)).toBe("1.0 MB/s");
  });

  it("formats values above 1 MB/s as MB/s", () => {
    expect(formatSpeed(5_500_000)).toBe("5.5 MB/s");
  });

  it("formats zero as KB/s", () => {
    expect(formatSpeed(0)).toBe("0.0 KB/s");
  });
});

describe("formatBytes", () => {
  it("formats values below 1 GB as MB", () => {
    expect(formatBytes(345_000_000)).toBe("345.0 MB");
  });

  it("formats values at exactly 1 GB as GB", () => {
    expect(formatBytes(1_000_000_000)).toBe("1.0 GB");
  });

  it("formats values above 1 GB as GB", () => {
    expect(formatBytes(1_200_000_000)).toBe("1.2 GB");
  });

  it("formats zero as MB", () => {
    expect(formatBytes(0)).toBe("0.0 MB");
  });
});

const noop = () => {};

const SAMPLE_DATA = {
  dl_info_speed: 5_500_000,
  up_info_speed: 500_000,
  dl_info_data: 1_200_000_000,
  up_info_data: 345_000_000,
  activity: { active: 16, queued: 4 },
};

describe("QbittorrentStatsWidget", () => {
  it("shows the shared loading state when data is null and loading", () => {
    render(
      <QbittorrentStatsWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByRole("status", { name: "Loading widget" })).toBeInTheDocument();
  });

  it("shows the shared error state when data is null and error is set", () => {
    render(
      <QbittorrentStatsWidget data={null} loading={false} error="connection refused" refresh={noop} />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("connection refused");
  });

  it("shows a domain empty state when transfer data is unavailable", () => {
    render(<QbittorrentStatsWidget data={null} loading={false} error={null} refresh={noop} />);
    expect(screen.getByText("No transfer data available")).toBeInTheDocument();
    expect(screen.queryByText(/MB\/s/)).not.toBeInTheDocument();
  });

  it("renders only current download and upload speeds at 3x2", () => {
    const { container } = render(
      <QbittorrentStatsWidget
        data={SAMPLE_DATA}
        loading={false}
        error={null}
        refresh={noop}
        footprint={{ columnSpan: 3, rowSpan: 2 }}
      />
    );
    expect(screen.getByText("5.5 MB/s")).toBeInTheDocument();
    expect(screen.getByText("500.0 KB/s")).toBeInTheDocument();
    expect(screen.queryByText("1.2 GB")).not.toBeInTheDocument();
    expect(screen.queryByText("345.0 MB")).not.toBeInTheDocument();
    expect(container.querySelector(".qbt-stats-widget")).toHaveAttribute("data-footprint", "3x2");
    expect(container.querySelector(".qbt-stats-widget__grid")).toHaveAttribute("data-columns", "2");
    expect(container.querySelector(".qbt-stats-widget__activity-stat")).not.toBeInTheDocument();
  });

  it("renders speeds and totals in two columns at 3x4", () => {
    const { container } = render(
      <QbittorrentStatsWidget
        data={SAMPLE_DATA}
        loading={false}
        error={null}
        refresh={noop}
        footprint={{ columnSpan: 3, rowSpan: 4 }}
      />
    );
    expect(screen.getByText("5.5 MB/s")).toBeInTheDocument();
    expect(screen.getByText("500.0 KB/s")).toBeInTheDocument();
    expect(screen.getByText("1.2 GB")).toBeInTheDocument();
    expect(screen.getByText("345.0 MB")).toBeInTheDocument();
    expect(container.querySelector(".qbt-stats-widget__grid")).toHaveAttribute("data-columns", "2");
    expect(container.querySelectorAll(".widget-stat")).toHaveLength(6);
    expect(container.querySelectorAll(".qbt-stats-widget__activity-stat")).toHaveLength(2);
    expect(screen.getByText("Active")).toHaveAttribute("title", "All torrents except queued");
    expect(screen.getByText("Active").closest("dt")?.nextElementSibling).toHaveTextContent("16");
    expect(screen.getByText("Queued").nextElementSibling).toHaveTextContent("4");
  });

  it("keeps all six cards when activity is unavailable at 3x4", () => {
    const { container } = render(
      <QbittorrentStatsWidget
        data={{ ...SAMPLE_DATA, activity: null }}
        loading={false}
        error={null}
        refresh={noop}
        footprint={{ columnSpan: 3, rowSpan: 4 }}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("Activity unavailable");
    expect(screen.getByText("5.5 MB/s")).toBeInTheDocument();
    expect(container.querySelectorAll(".widget-stat")).toHaveLength(6);
    expect(container.querySelectorAll(".qbt-stats-widget__activity-stat dd"))
      .toHaveLength(2);
    expect(Array.from(container.querySelectorAll(".qbt-stats-widget__activity-stat dd"),
      (item) => item.textContent)).toEqual(["—", "—"]);
  });

  it("renders all four values in one row at 6x2", () => {
    const { container } = render(
      <QbittorrentStatsWidget
        data={SAMPLE_DATA}
        loading={false}
        error={null}
        refresh={noop}
        footprint={{ columnSpan: 6, rowSpan: 2 }}
      />
    );
    expect(screen.getByText("5.5 MB/s")).toBeInTheDocument();
    expect(screen.getByText("500.0 KB/s")).toBeInTheDocument();
    expect(screen.getByText("1.2 GB")).toBeInTheDocument();
    expect(screen.getByText("345.0 MB")).toBeInTheDocument();
    expect(container.querySelector(".qbt-stats-widget__grid")).toHaveAttribute("data-columns", "4");
    expect(container.querySelector(".qbt-stats-widget__activity-stat")).not.toBeInTheDocument();
  });

  it("shows the stale notice alongside formatted saved data", () => {
    render(
      <QbittorrentStatsWidget
        data={SAMPLE_DATA}
        loading={false}
        error="refresh failed"
        refresh={noop}
        footprint={{ columnSpan: 6, rowSpan: 2 }}
      />
    );
    expect(screen.getByText("5.5 MB/s")).toBeInTheDocument();
    expect(screen.getByRole("alert", { name: /refresh failed; saved data is shown.*refresh failed/i }))
      .toHaveTextContent("Refresh failed · saved data");
  });
});
