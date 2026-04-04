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
};

describe("QbittorrentStatsWidget", () => {
  it("shows loading hint when data is null and loading", () => {
    render(
      <QbittorrentStatsWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <QbittorrentStatsWidget data={null} loading={false} error="connection refused" refresh={noop} />
    );
    expect(screen.getByText("connection refused")).toBeInTheDocument();
  });

  it("renders download speed above 1 MB/s as MB/s", () => {
    render(
      <QbittorrentStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("5.5 MB/s")).toBeInTheDocument();
    expect(screen.getByText("↓ Speed")).toBeInTheDocument();
  });

  it("renders upload speed below 1 MB/s as KB/s", () => {
    render(
      <QbittorrentStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("500.0 KB/s")).toBeInTheDocument();
    expect(screen.getByText("↑ Speed")).toBeInTheDocument();
  });

  it("renders session download total above 1 GB as GB", () => {
    render(
      <QbittorrentStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("1.2 GB")).toBeInTheDocument();
    expect(screen.getByText("↓ Total")).toBeInTheDocument();
  });

  it("renders session upload total below 1 GB as MB", () => {
    render(
      <QbittorrentStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("345.0 MB")).toBeInTheDocument();
    expect(screen.getByText("↑ Total")).toBeInTheDocument();
  });

  it("shows stale error alongside data when data is non-null and error is set", () => {
    render(
      <QbittorrentStatsWidget data={SAMPLE_DATA} loading={false} error="refresh failed" refresh={noop} />
    );
    expect(screen.getByText("5.5 MB/s")).toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
  });

  it("renders nothing meaningful when data is null and neither loading nor error", () => {
    const { container } = render(
      <QbittorrentStatsWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(container.querySelector(".qbt-stats-widget--empty")).toBeInTheDocument();
    expect(screen.queryByText(/MB\/s/)).not.toBeInTheDocument();
  });
});
