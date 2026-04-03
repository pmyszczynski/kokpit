import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QbittorrentStatsWidget } from "@/integrations/qbittorrent/statsWidget";

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
    expect(screen.getByText("↓ 5.5 MB/s")).toBeInTheDocument();
  });

  it("renders upload speed below 1 MB/s as KB/s", () => {
    render(
      <QbittorrentStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("↑ 500.0 KB/s")).toBeInTheDocument();
  });

  it("renders session download total above 1 GB as GB", () => {
    render(
      <QbittorrentStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("↓ total 1.2 GB")).toBeInTheDocument();
  });

  it("renders session upload total below 1 GB as MB", () => {
    render(
      <QbittorrentStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("↑ total 345.0 MB")).toBeInTheDocument();
  });

  it("shows stale error alongside data when data is non-null and error is set", () => {
    render(
      <QbittorrentStatsWidget data={SAMPLE_DATA} loading={false} error="refresh failed" refresh={noop} />
    );
    expect(screen.getByText("↓ 5.5 MB/s")).toBeInTheDocument();
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
