import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WidgetStaleNotice } from "./WidgetStaleNotice";

describe("WidgetStaleNotice", () => {
  it("only announces a refresh failure while an error is present", () => {
    const { rerender } = render(<WidgetStaleNotice error={null} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    rerender(<WidgetStaleNotice error="connection refused" />);
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("Refresh failed · saved data");
    expect(notice).toHaveAttribute("title", "connection refused");
    expect(notice).toHaveAccessibleName(
      "Refresh failed; saved data is shown. connection refused"
    );

    rerender(<WidgetStaleNotice error={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps caller class hooks and custom visible copy", () => {
    render(
      <WidgetStaleNotice
        error="timeout"
        message="Showing cached data"
        className="immich-stats-widget__stale-error"
      />
    );

    expect(screen.getByRole("alert")).toHaveClass(
      "widget-ui",
      "widget-stale-notice",
      "immich-stats-widget__stale-error"
    );
    expect(screen.getByRole("alert")).toHaveAccessibleName("Showing cached data. timeout");
  });
});
