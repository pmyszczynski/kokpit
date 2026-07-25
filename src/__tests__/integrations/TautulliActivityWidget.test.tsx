import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  formatBandwidth,
  TautulliActivityWidget,
} from "@/integrations/tautulli/activityWidget";

const noop = () => {};

const SAMPLE_DATA = {
  summary: {
    streamCount: 2,
    directPlayCount: 1,
    directStreamCount: 0,
    transcodeCount: 1,
    totalBandwidthKbps: 12_500,
  },
  sessions: [{
    username: "alice",
    title: "The Expanse · S02E05",
    progressPercent: 42.8,
    state: "playing",
    mediaType: "episode",
    transcodeDecision: "transcode",
  }],
};

describe("TautulliActivityWidget", () => {
  it("renders the five summary values and labels", () => {
    render(<TautulliActivityWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />);

    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getAllByText("1", { selector: ".tautulli-activity-widget__value" })).toHaveLength(2);
    expect(screen.getByText("Direct Play")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("Direct Stream")).toBeInTheDocument();
    expect(screen.getByText("Transcoding")).toBeInTheDocument();
    expect(screen.getByText("12.5 Mbps")).toBeInTheDocument();
    expect(screen.getByText("Bandwidth")).toBeInTheDocument();
  });

  it("formats bandwidth as Kbps, Mbps, and Gbps at decimal thresholds", () => {
    expect(formatBandwidth(999)).toBe("999 Kbps");
    expect(formatBandwidth(1_000)).toBe("1.0 Mbps");
    expect(formatBandwidth(1_000_000)).toBe("1.0 Gbps");
  });

  it("renders username, state, title, media type, and transcode mode", () => {
    render(<TautulliActivityWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />);

    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("Playing")).toBeInTheDocument();
    expect(screen.getByText("The Expanse · S02E05")).toBeInTheDocument();
    expect(screen.getByText("Episode · Transcode")).toBeInTheDocument();
  });

  it("renders an accessible clamped progress bar and rounded percentage", () => {
    render(<TautulliActivityWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />);

    expect(screen.getByRole("progressbar", { name: /alice progress/i }))
      .toHaveAttribute("aria-valuenow", "43");
    expect(screen.getByText("43%")).toBeInTheDocument();
  });

  it("renders summary-only data without a session list", () => {
    render(<TautulliActivityWidget data={{ summary: SAMPLE_DATA.summary }} loading={false} error={null} refresh={noop} />);

    expect(screen.getByLabelText("Tautulli summary")).toBeInTheDocument();
    expect(screen.queryByLabelText("Active Tautulli sessions")).not.toBeInTheDocument();
  });

  it("renders sessions-only data without a summary row", () => {
    render(<TautulliActivityWidget data={{ sessions: SAMPLE_DATA.sessions }} loading={false} error={null} refresh={noop} />);

    expect(screen.queryByLabelText("Tautulli summary")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Active Tautulli sessions")).toBeInTheDocument();
  });

  it('shows "No active streams" for an empty selected session list', () => {
    render(<TautulliActivityWidget data={{ sessions: [] }} loading={false} error={null} refresh={noop} />);

    expect(screen.getByText("No active streams")).toBeInTheDocument();
  });

  it("shows loading when data is null", () => {
    render(<TautulliActivityWidget data={null} loading={true} error={null} refresh={noop} />);

    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows an initial error when data is null", () => {
    render(<TautulliActivityWidget data={null} loading={false} error="Tautulli responded with 401" refresh={noop} />);

    expect(screen.getByText("Tautulli responded with 401")).toBeInTheDocument();
  });

  it("keeps data visible with a stale error alert", () => {
    render(<TautulliActivityWidget data={SAMPLE_DATA} loading={false} error="Refresh failed" refresh={noop} />);

    expect(screen.getByText("12.5 Mbps")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Refresh failed");
  });

  it("renders the empty CSS state when data, loading, and error are absent", () => {
    const { container } = render(
      <TautulliActivityWidget data={null} loading={false} error={null} refresh={noop} />
    );

    expect(container.querySelector(".tautulli-activity-widget--empty")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tautulli summary")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Active Tautulli sessions")).not.toBeInTheDocument();
  });
});
