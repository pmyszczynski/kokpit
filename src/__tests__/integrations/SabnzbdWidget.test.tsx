import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SabnzbdWidget } from "@/integrations/sabnzbd/widget";

const noop = () => {};

const SAMPLE_DATA = {
  speedBytesPerSec: 5_500_000,
  queueCount: 4,
  totalMb: 1_200,
};

describe("SabnzbdWidget component", () => {
  it("renders speed, queue count, and queue size with correct labels", () => {
    render(
      <SabnzbdWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("5.5 MB/s")).toBeInTheDocument();
    expect(screen.getByText("↓ Speed")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Queue")).toBeInTheDocument();
    expect(screen.getByText("1.2 GB")).toBeInTheDocument();
    expect(screen.getByText("Queue Size")).toBeInTheDocument();
  });

  it("formats speed below 1 MB/s as KB/s", () => {
    render(
      <SabnzbdWidget
        data={{ speedBytesPerSec: 500_000, queueCount: 0, totalMb: 0 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("500.0 KB/s")).toBeInTheDocument();
  });

  it("formats speed at/above 1 MB/s as MB/s", () => {
    render(
      <SabnzbdWidget
        data={{ speedBytesPerSec: 1_000_000, queueCount: 0, totalMb: 0 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("1.0 MB/s")).toBeInTheDocument();
  });

  it("formats size below 1000 MB as MB", () => {
    render(
      <SabnzbdWidget
        data={{ speedBytesPerSec: 0, queueCount: 0, totalMb: 345 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("345.0 MB")).toBeInTheDocument();
  });

  it("formats size at/above 1000 MB as GB", () => {
    render(
      <SabnzbdWidget
        data={{ speedBytesPerSec: 0, queueCount: 0, totalMb: 1_000 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("1.0 GB")).toBeInTheDocument();
  });

  it("shows loading hint when data is null and loading", () => {
    render(
      <SabnzbdWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <SabnzbdWidget
        data={null}
        loading={false}
        error="SABnzbd responded with 401"
        refresh={noop}
      />
    );
    expect(screen.getByText("SABnzbd responded with 401")).toBeInTheDocument();
  });

  it("shows stale error alongside data when data is non-null and error is set", () => {
    render(
      <SabnzbdWidget
        data={SAMPLE_DATA}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("5.5 MB/s")).toBeInTheDocument();
    const errorEl = screen.getByRole("alert");
    expect(errorEl).toHaveTextContent("refresh failed");
  });

  it("renders nothing meaningful when data is null and neither loading nor error", () => {
    const { container } = render(
      <SabnzbdWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(
      container.querySelector(".sabnzbd-widget--empty")
    ).toBeInTheDocument();
    expect(screen.queryByText("Queue")).not.toBeInTheDocument();
  });
});
