import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WidgetStaleNotice } from "./WidgetStaleNotice";

describe("WidgetStaleNotice", () => {
  it("replaces the alert for a new error and removes it on recovery", () => {
    const { rerender } = render(<WidgetStaleNotice error="connection refused" />);
    const firstNotice = screen.getByRole("alert");

    expect(firstNotice).toHaveTextContent("Refresh failed · saved data");
    expect(firstNotice).toHaveAttribute("title", "connection refused");
    expect(firstNotice).toHaveAttribute("aria-atomic", "true");
    expect(firstNotice).toHaveAccessibleName(
      "Refresh failed; saved data is shown. connection refused"
    );

    rerender(<WidgetStaleNotice error="connection refused" />);
    expect(screen.getByRole("alert")).toBe(firstNotice);

    rerender(<WidgetStaleNotice error="request timed out" />);
    const updatedNotice = screen.getByRole("alert");
    expect(updatedNotice).not.toBe(firstNotice);
    expect(updatedNotice).toHaveAccessibleName(
      "Refresh failed; saved data is shown. request timed out"
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
