import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SonarrQueueWidget } from "@/integrations/sonarr/queueWidget";
import type { SonarrQueueItem } from "@/integrations/sonarr/api";

const noop = () => {};

const SAMPLE_QUEUE: SonarrQueueItem[] = [
  {
    id: 101,
    title: "Breaking.Bad.S01E01",
    seriesTitle: "Breaking Bad",
    status: "downloading",
    timeleft: "00:12:34",
    size: 1_000_000_000,
    sizeleft: 300_000_000,
    trackedDownloadStatus: "ok",
  },
  {
    id: 102,
    title: "Breaking.Bad.S01E02",
    seriesTitle: "Breaking Bad",
    status: "queued",
    // timeleft intentionally omitted
    size: 900_000_000,
    sizeleft: 900_000_000,
    trackedDownloadStatus: "warning",
  },
];

describe("SonarrQueueWidget", () => {
  it("shows loading hint when data is null and loading", () => {
    render(
      <SonarrQueueWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <SonarrQueueWidget
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
      <SonarrQueueWidget data={[]} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("Queue is empty")).toBeInTheDocument();
  });

  it("shows stale error alongside 'Queue is empty' when empty and error is set", () => {
    render(
      <SonarrQueueWidget
        data={[]}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("Queue is empty")).toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
  });

  it("renders item titles", () => {
    render(
      <SonarrQueueWidget data={SAMPLE_QUEUE} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("Breaking.Bad.S01E01")).toBeInTheDocument();
    expect(screen.getByText("Breaking.Bad.S01E02")).toBeInTheDocument();
  });

  it("renders progress as percentage", () => {
    render(
      <SonarrQueueWidget data={SAMPLE_QUEUE} loading={false} error={null} refresh={noop} />
    );
    // item[0]: (1 - 300M/1000M) * 100 = 70%
    expect(screen.getByText("70%")).toBeInTheDocument();
    // item[1]: (1 - 900M/900M) * 100 = 0%
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("renders timeleft when present", () => {
    render(
      <SonarrQueueWidget data={SAMPLE_QUEUE} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("00:12:34")).toBeInTheDocument();
  });

  it("renders em dash when timeleft is undefined", () => {
    render(
      <SonarrQueueWidget data={SAMPLE_QUEUE} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders 0% when size is 0", () => {
    const zeroSize: SonarrQueueItem[] = [
      {
        id: 200,
        title: "Zero.Size.Item",
        seriesTitle: "Test Show",
        status: "queued",
        size: 0,
        sizeleft: 0,
        trackedDownloadStatus: "ok",
      },
    ];
    render(
      <SonarrQueueWidget data={zeroSize} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("shows stale error alongside data when data is non-null and error is set", () => {
    render(
      <SonarrQueueWidget
        data={SAMPLE_QUEUE}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("Breaking.Bad.S01E01")).toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
  });

  it("renders --empty container when data is null and neither loading nor error", () => {
    const { container } = render(
      <SonarrQueueWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(
      container.querySelector(".sonarr-queue-widget--empty")
    ).toBeInTheDocument();
    expect(screen.queryByText("Breaking.Bad.S01E01")).not.toBeInTheDocument();
  });
});
