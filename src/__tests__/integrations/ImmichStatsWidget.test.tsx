import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImmichStatsWidget } from "@/integrations/immich/statsWidget";

const noop = () => {};

const SAMPLE_DATA = {
  photos: 123_555_000,
  videos: 554,
  usage: 1_500_000_000,
  usagePhotos: 1_200_000_000,
  usageVideos: 345_000_000,
};

describe("ImmichStatsWidget component", () => {
  it("renders storage and total items", () => {
    render(
      <ImmichStatsWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("1.5 GB")).toBeInTheDocument();
    expect(screen.getByText("Storage")).toBeInTheDocument();
    expect(screen.getByText("123,555,554")).toBeInTheDocument();
    expect(screen.getByText("Items")).toBeInTheDocument();
    expect(screen.queryByText("Photos")).not.toBeInTheDocument();
    expect(screen.queryByText("Videos")).not.toBeInTheDocument();
    expect(screen.queryByText("Photo Size")).not.toBeInTheDocument();
    expect(screen.queryByText("Video Size")).not.toBeInTheDocument();
  });

  it.each([
    [0, "0 B"],
    [999, "999 B"],
    [1_000, "1.0 KB"],
    [1_000_000, "1.0 MB"],
    [1_000_000_000, "1.0 GB"],
    [1_000_000_000_000, "1.0 TB"],
  ])("formats total storage at decimal byte boundary %i", (usage, expected) => {
    render(
      <ImmichStatsWidget
        data={{ ...SAMPLE_DATA, usage }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("shows loading hint when data is null and loading", () => {
    render(
      <ImmichStatsWidget data={null} loading={true} error={null} refresh={noop} />
    );
    expect(screen.getByRole("status", { name: "Loading widget" })).toBeInTheDocument();
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
    expect(screen.getByText("123,555,554")).toBeInTheDocument();
    const errorEl = screen.getByRole("alert");
    expect(errorEl).toHaveTextContent("Refresh failed · saved data");
    expect(errorEl).toHaveAttribute("title", "refresh failed");
    expect(errorEl).toHaveAccessibleName(
      "Refresh failed; saved data is shown. refresh failed"
    );
  });

  it("only exposes an alert while a refresh error is present", () => {
    const props = { data: SAMPLE_DATA, loading: false, refresh: noop };
    const { rerender } = render(<ImmichStatsWidget {...props} error={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Refresh failed · saved data")).not.toBeInTheDocument();

    rerender(<ImmichStatsWidget {...props} error="Refresh failed" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(<ImmichStatsWidget {...props} error={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Refresh failed · saved data")).not.toBeInTheDocument();
    expect(screen.getByText("123,555,554")).toBeInTheDocument();
  });

  it("renders nothing meaningful when data is null and neither loading nor error", () => {
    const { container } = render(
      <ImmichStatsWidget data={null} loading={false} error={null} refresh={noop} />
    );
    expect(
      container.querySelector(".immich-stats-widget--empty")
    ).toBeInTheDocument();
    expect(screen.queryByText("Storage")).not.toBeInTheDocument();
    expect(screen.queryByText("Items")).not.toBeInTheDocument();
  });
});
