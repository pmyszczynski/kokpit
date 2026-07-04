import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RadarrQueueWidget } from "@/integrations/radarr/queueWidget";
import { RadarrStatsWidget } from "@/integrations/radarr/statsWidget";
import type { RadarrQueueItem, RadarrStats } from "@/integrations/radarr/api";

const noop = () => {};

// ---------------------------------------------------------------------------
// RadarrQueueWidget
// ---------------------------------------------------------------------------

const SAMPLE_QUEUE: RadarrQueueItem[] = [
  {
    id: 101,
    title: "The.Dark.Knight.2008",
    movieTitle: "The Dark Knight",
    status: "downloading",
    timeleft: "00:12:34",
    size: 1_000_000_000,
    sizeleft: 300_000_000,
    trackedDownloadStatus: "ok",
  },
  {
    id: 102,
    title: "Inception.2010",
    movieTitle: "Inception",
    status: "queued",
    // timeleft intentionally omitted
    size: 900_000_000,
    sizeleft: 900_000_000,
    trackedDownloadStatus: "warning",
  },
];

describe("RadarrQueueWidget", () => {
  it("shows loading hint when data is null and loading", () => {
    render(
      <RadarrQueueWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <RadarrQueueWidget
        data={null}
        loading={false}
        error="connection refused"
        refresh={noop}
      />
    );
    expect(screen.getByText("connection refused")).toBeInTheDocument();
  });

  it("shows 'Queue is empty' when data is empty", () => {
    render(
      <RadarrQueueWidget data={[]} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("Queue is empty")).toBeInTheDocument();
  });

  it("shows stale error alongside 'Queue is empty' when empty and error is set", () => {
    render(
      <RadarrQueueWidget
        data={[]}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("Queue is empty")).toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
  });

  it("renders movie titles", () => {
    render(
      <RadarrQueueWidget data={SAMPLE_QUEUE} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("The Dark Knight")).toBeInTheDocument();
    expect(screen.getByText("Inception")).toBeInTheDocument();
  });

  it("renders progress as percentage", () => {
    render(
      <RadarrQueueWidget data={SAMPLE_QUEUE} loading={false} error={null} refresh={noop} />
    );
    // item[0]: (1 - 300M/1000M) * 100 = 70%
    expect(screen.getByText("70%")).toBeInTheDocument();
    // item[1]: (1 - 900M/900M) * 100 = 0%
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("renders timeleft when present", () => {
    render(
      <RadarrQueueWidget data={SAMPLE_QUEUE} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("00:12:34")).toBeInTheDocument();
  });

  it("renders em dash when timeleft is undefined", () => {
    render(
      <RadarrQueueWidget data={SAMPLE_QUEUE} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders 0% when size is 0", () => {
    const zeroSize: RadarrQueueItem[] = [
      {
        id: 200,
        title: "Zero.Size.Item",
        movieTitle: "Zero Size Movie",
        status: "queued",
        size: 0,
        sizeleft: 0,
        trackedDownloadStatus: "ok",
      },
    ];
    render(
      <RadarrQueueWidget data={zeroSize} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("shows stale error alongside data when data is non-null and error is set", () => {
    render(
      <RadarrQueueWidget
        data={SAMPLE_QUEUE}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("The Dark Knight")).toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
  });

  it("renders --empty container when data is null and neither loading nor error", () => {
    const { container } = render(
      <RadarrQueueWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(
      container.querySelector(".radarr-queue-widget--empty")
    ).toBeInTheDocument();
    expect(screen.queryByText("The Dark Knight")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RadarrStatsWidget
// ---------------------------------------------------------------------------

const SAMPLE_STATS: RadarrStats = {
  total: 120,
  available: 90,
  missing: 5,
  wanted: 10,
  upcoming: 8,
  queued: 2,
};

describe("RadarrStatsWidget", () => {
  it("renders all 6 stats with correct values and labels", () => {
    render(
      <RadarrStatsWidget data={SAMPLE_STATS} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Wanted")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("shows loading hint when data is null and loading", () => {
    render(
      <RadarrStatsWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <RadarrStatsWidget
        data={null}
        loading={false}
        error="Radarr responded with 401"
        refresh={noop}
      />
    );
    expect(screen.getByText("Radarr responded with 401")).toBeInTheDocument();
  });

  it("shows stale error alongside data when data is non-null and error is set", () => {
    render(
      <RadarrStatsWidget
        data={SAMPLE_STATS}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("120")).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("refresh failed");
  });

  it("renders --empty container when data is null and neither loading nor error", () => {
    const { container } = render(
      <RadarrStatsWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(
      container.querySelector(".radarr-stats-widget--empty")
    ).toBeInTheDocument();
    expect(screen.queryByText("Missing")).not.toBeInTheDocument();
  });
});
