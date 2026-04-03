import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QbittorrentTorrentsWidget } from "@/integrations/qbittorrent/torrentsWidget";
import { formatSpeed } from "@/integrations/qbittorrent/torrentsWidget";

const noop = () => {};

const SAMPLE_TORRENTS = [
  { hash: "abc123", name: "Ubuntu 24.04", progress: 0.74, dlspeed: 12_000_000, upspeed: 0 },
  { hash: "def456", name: "Fedora 40", progress: 1.0, dlspeed: 0, upspeed: 1_000_000 },
];

describe("formatSpeed", () => {
  it("formats values below 1 MB/s as KB/s", () => {
    expect(formatSpeed(500_000)).toBe("500.0 KB/s");
  });

  it("formats values at exactly 1 MB/s as MB/s", () => {
    expect(formatSpeed(1_000_000)).toBe("1.0 MB/s");
  });

  it("formats values above 1 MB/s as MB/s", () => {
    expect(formatSpeed(12_000_000)).toBe("12.0 MB/s");
  });

  it("formats zero as KB/s", () => {
    expect(formatSpeed(0)).toBe("0.0 KB/s");
  });
});

describe("QbittorrentTorrentsWidget", () => {
  it("shows loading hint when data is null and loading", () => {
    render(
      <QbittorrentTorrentsWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <QbittorrentTorrentsWidget data={null} loading={false} error="connection refused" refresh={noop} />
    );
    expect(screen.getByText("connection refused")).toBeInTheDocument();
  });

  it("shows 'No torrents' when list is empty", () => {
    render(
      <QbittorrentTorrentsWidget data={[]} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("No torrents")).toBeInTheDocument();
  });

  it("renders torrent names", () => {
    render(
      <QbittorrentTorrentsWidget data={SAMPLE_TORRENTS} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("Ubuntu 24.04")).toBeInTheDocument();
    expect(screen.getByText("Fedora 40")).toBeInTheDocument();
  });

  it("renders progress as rounded percentage", () => {
    render(
      <QbittorrentTorrentsWidget data={SAMPLE_TORRENTS} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("74%")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("renders download speed above 1 MB/s as MB/s", () => {
    render(
      <QbittorrentTorrentsWidget data={SAMPLE_TORRENTS} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("12.0 MB/s")).toBeInTheDocument();
  });

  it("renders upload speed above 1 MB/s as MB/s", () => {
    render(
      <QbittorrentTorrentsWidget data={SAMPLE_TORRENTS} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("1.0 MB/s")).toBeInTheDocument();
  });

  it("renders zero speed as KB/s", () => {
    render(
      <QbittorrentTorrentsWidget data={SAMPLE_TORRENTS} loading={false} error={null} refresh={noop} />
    );
    // Two zero-speed values: Ubuntu upspeed=0 and Fedora dlspeed=0
    const zeros = screen.getAllByText("0.0 KB/s");
    expect(zeros).toHaveLength(2);
  });

  it("shows stale error alongside data when data is non-null and error is set", () => {
    render(
      <QbittorrentTorrentsWidget
        data={SAMPLE_TORRENTS}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("Ubuntu 24.04")).toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
  });

  it("renders nothing meaningful when data is null and neither loading nor error", () => {
    const { container } = render(
      <QbittorrentTorrentsWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(container.querySelector(".qbt-torrents-widget--empty")).toBeInTheDocument();
    expect(screen.queryByText("Ubuntu 24.04")).not.toBeInTheDocument();
  });
});
