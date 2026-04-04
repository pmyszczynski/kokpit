import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SonarrCalendarWidget } from "@/integrations/sonarr/calendarWidget";
import type { SonarrEpisode } from "@/integrations/sonarr/api";

const noop = () => {};

const SAMPLE_EPISODES: SonarrEpisode[] = [
  {
    id: 1,
    title: "Pilot",
    seriesTitle: "Breaking Bad",
    airDateUtc: "2026-04-05T02:00:00Z",
    seasonNumber: 1,
    episodeNumber: 1,
    hasFile: true,
    monitored: true,
  },
  {
    id: 2,
    title: "Cat's in the Bag",
    seriesTitle: "Breaking Bad",
    airDateUtc: "2026-04-06T02:00:00Z",
    seasonNumber: 1,
    episodeNumber: 2,
    hasFile: false,
    monitored: true,
  },
];

describe("SonarrCalendarWidget", () => {
  it("shows loading hint when data is null and loading", () => {
    render(
      <SonarrCalendarWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <SonarrCalendarWidget
        data={null}
        loading={false}
        error="connection refused"
        refresh={noop}
      />
    );
    expect(screen.getByText("connection refused")).toBeInTheDocument();
  });

  it("shows 'No upcoming episodes' when data is empty", () => {
    render(
      <SonarrCalendarWidget data={[]} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("No upcoming episodes")).toBeInTheDocument();
  });

  it("shows stale error alongside 'No upcoming episodes' when empty and error is set", () => {
    render(
      <SonarrCalendarWidget
        data={[]}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("No upcoming episodes")).toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
  });

  it("renders series titles", () => {
    render(
      <SonarrCalendarWidget
        data={SAMPLE_EPISODES}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    const titles = screen.getAllByText("Breaking Bad");
    expect(titles.length).toBeGreaterThan(0);
  });

  it("renders episode codes in S01E01 format", () => {
    render(
      <SonarrCalendarWidget
        data={SAMPLE_EPISODES}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText(/S01E01/)).toBeInTheDocument();
    expect(screen.getByText(/S01E02/)).toBeInTheDocument();
  });

  it("renders episode title text", () => {
    render(
      <SonarrCalendarWidget
        data={SAMPLE_EPISODES}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText(/Pilot/)).toBeInTheDocument();
  });

  it("shows 'downloaded' badge when hasFile is true", () => {
    render(
      <SonarrCalendarWidget
        data={SAMPLE_EPISODES}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("downloaded")).toBeInTheDocument();
  });

  it("shows 'upcoming' badge when hasFile is false", () => {
    render(
      <SonarrCalendarWidget
        data={SAMPLE_EPISODES}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("upcoming")).toBeInTheDocument();
  });

  it("shows stale error alongside data when data is non-null and error is set", () => {
    render(
      <SonarrCalendarWidget
        data={SAMPLE_EPISODES}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    const titles = screen.getAllByText("Breaking Bad");
    expect(titles.length).toBeGreaterThan(0);
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
  });

  it("renders --empty container when data is null and neither loading nor error", () => {
    const { container } = render(
      <SonarrCalendarWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(
      container.querySelector(".sonarr-calendar-widget--empty")
    ).toBeInTheDocument();
    expect(screen.queryByText("Breaking Bad")).not.toBeInTheDocument();
  });
});
