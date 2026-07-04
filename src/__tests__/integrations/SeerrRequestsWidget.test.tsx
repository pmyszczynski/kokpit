import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SeerrRequestsWidget } from "@/integrations/seerr/requestsWidget";
import type { SeerrRequest } from "@/integrations/seerr/api";

const noop = () => {};

function makeRequest(overrides: Partial<SeerrRequest> = {}): SeerrRequest {
  return {
    id: 1,
    requestStatus: 1,
    mediaStatus: 3,
    mediaType: "movie",
    title: "Test Movie",
    seasons: null,
    tmdbId: 100,
    requestedBy: "Alice",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("SeerrRequestsWidget component", () => {
  it("renders a pending request (default requestStatus, mediaStatus not available)", () => {
    const { container } = render(
      <SeerrRequestsWidget
        data={[makeRequest({ requestStatus: 1, mediaStatus: 3 })]}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(
      container.querySelector(".seerr-requests-widget__badge--pending")
    ).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("renders an approved request (requestStatus 2)", () => {
    const { container } = render(
      <SeerrRequestsWidget
        data={[makeRequest({ requestStatus: 2, mediaStatus: 3 })]}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(
      container.querySelector(".seerr-requests-widget__badge--approved")
    ).toBeInTheDocument();
    expect(screen.getByText("approved")).toBeInTheDocument();
  });

  it("renders a declined request (requestStatus 3)", () => {
    const { container } = render(
      <SeerrRequestsWidget
        data={[makeRequest({ requestStatus: 3, mediaStatus: 3 })]}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(
      container.querySelector(".seerr-requests-widget__badge--declined")
    ).toBeInTheDocument();
    expect(screen.getByText("declined")).toBeInTheDocument();
  });

  it("renders a failed request (requestStatus 4)", () => {
    const { container } = render(
      <SeerrRequestsWidget
        data={[makeRequest({ requestStatus: 4, mediaStatus: 3 })]}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(
      container.querySelector(".seerr-requests-widget__badge--failed")
    ).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("renders an available request when mediaStatus is 5, taking priority over requestStatus", () => {
    const { container } = render(
      <SeerrRequestsWidget
        data={[makeRequest({ requestStatus: 2, mediaStatus: 5 })]}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(
      container.querySelector(".seerr-requests-widget__badge--available")
    ).toBeInTheDocument();
    expect(screen.getByText("available")).toBeInTheDocument();
  });

  it("formats a single season", () => {
    render(
      <SeerrRequestsWidget
        data={[
          makeRequest({
            mediaType: "tv",
            title: "Show A",
            seasons: [1],
          }),
        ]}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("Show A S01")).toBeInTheDocument();
  });

  it("formats a contiguous season range", () => {
    render(
      <SeerrRequestsWidget
        data={[
          makeRequest({
            mediaType: "tv",
            title: "Show B",
            seasons: [1, 2, 3],
          }),
        ]}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("Show B S01-S03")).toBeInTheDocument();
  });

  it("formats a non-contiguous season list", () => {
    render(
      <SeerrRequestsWidget
        data={[
          makeRequest({
            mediaType: "tv",
            title: "Show C",
            seasons: [1, 3],
          }),
        ]}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("Show C S01,S03")).toBeInTheDocument();
  });

  it("falls back to (Movie) title when title is missing for a movie", () => {
    render(
      <SeerrRequestsWidget
        data={[makeRequest({ mediaType: "movie", title: null, seasons: null })]}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("(Movie)")).toBeInTheDocument();
  });

  it("falls back to (Show) title when title is missing for a tv show with no seasons", () => {
    render(
      <SeerrRequestsWidget
        data={[makeRequest({ mediaType: "tv", title: null, seasons: null })]}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("(Show)")).toBeInTheDocument();
  });

  it("renders relative time for a recent timestamp", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    render(
      <SeerrRequestsWidget
        data={[makeRequest({ createdAt: fiveMinutesAgo })]}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("5m ago")).toBeInTheDocument();
  });

  it("renders 'unknown' for an invalid date string", () => {
    render(
      <SeerrRequestsWidget
        data={[makeRequest({ createdAt: "not-a-real-date" })]}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });

  it("renders requester name", () => {
    render(
      <SeerrRequestsWidget
        data={[makeRequest({ requestedBy: "Bob" })]}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows 'No requests' hint when data is an empty list", () => {
    render(
      <SeerrRequestsWidget data={[]} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("No requests")).toBeInTheDocument();
  });

  it("shows stale error alongside 'No requests' when data is empty and error is set", () => {
    render(
      <SeerrRequestsWidget data={[]} loading={false} error="refresh failed" refresh={noop} />
    );
    expect(screen.getByText("No requests")).toBeInTheDocument();
    const errorEl = screen.getByRole("alert");
    expect(errorEl).toHaveTextContent("refresh failed");
  });

  it("shows loading hint when data is null and loading", () => {
    render(
      <SeerrRequestsWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <SeerrRequestsWidget
        data={null}
        loading={false}
        error="Seerr responded with 401"
        refresh={noop}
      />
    );
    expect(screen.getByText("Seerr responded with 401")).toBeInTheDocument();
  });

  it("shows stale error alongside data when data is non-null and error is set", () => {
    render(
      <SeerrRequestsWidget
        data={[makeRequest({ title: "Stale Movie" })]}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("Stale Movie")).toBeInTheDocument();
    const errorEl = screen.getByRole("alert");
    expect(errorEl).toHaveTextContent("refresh failed");
  });

  it("renders nothing meaningful when data is null and neither loading nor error, distinct from the empty-list state", () => {
    const { container } = render(
      <SeerrRequestsWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(
      container.querySelector(".seerr-requests-widget--empty")
    ).toBeInTheDocument();
    expect(screen.queryByText("No requests")).not.toBeInTheDocument();
  });
});
