import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImmichStatsWidget } from "@/integrations/immich/statsWidget";

const noop = () => {};

const SAMPLE_DATA = {
  photos: 12345,
  videos: 678,
  usage: 1_500_000_000,
  usagePhotos: 1_200_000_000,
  usageVideos: 345_000_000,
};

describe("ImmichStatsWidget component", () => {
  it("renders all stats with correct values and labels", () => {
    render(
      <ImmichStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("12,345")).toBeInTheDocument();
    expect(screen.getByText("Photos")).toBeInTheDocument();
    expect(screen.getByText("678")).toBeInTheDocument();
    expect(screen.getByText("Videos")).toBeInTheDocument();
    expect(screen.getByText("1.5 GB")).toBeInTheDocument();
    expect(screen.getByText("Storage")).toBeInTheDocument();
    expect(screen.getByText("1.2 GB")).toBeInTheDocument();
    expect(screen.getByText("Photo Size")).toBeInTheDocument();
    expect(screen.getByText("345.0 MB")).toBeInTheDocument();
    expect(screen.getByText("Video Size")).toBeInTheDocument();
  });

  it("formats byte values at the GB and MB magnitudes", () => {
    render(
      <ImmichStatsWidget
        data={{
          photos: 1,
          videos: 1,
          usage: 2_400_000_000,
          usagePhotos: 500_000_000,
          usageVideos: 0,
        }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("2.4 GB")).toBeInTheDocument();
    expect(screen.getByText("500.0 MB")).toBeInTheDocument();
    expect(screen.getByText("0 B")).toBeInTheDocument();
  });

  it("shows loading hint when data is null and loading", () => {
    render(
      <ImmichStatsWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <ImmichStatsWidget
        data={null}
        loading={false}
        error="Immich responded with 401"
        refresh={noop}
      />
    );
    expect(screen.getByText("Immich responded with 401")).toBeInTheDocument();
  });

  it("shows stale error alongside data when data is non-null and error is set", () => {
    render(
      <ImmichStatsWidget
        data={SAMPLE_DATA}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("12,345")).toBeInTheDocument();
    const errorEl = screen.getByRole("alert");
    expect(errorEl).toHaveTextContent("refresh failed");
  });

  it("renders nothing meaningful when data is null and neither loading nor error", () => {
    const { container } = render(
      <ImmichStatsWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(
      container.querySelector(".immich-stats-widget--empty")
    ).toBeInTheDocument();
    expect(screen.queryByText("Photos")).not.toBeInTheDocument();
  });
});
