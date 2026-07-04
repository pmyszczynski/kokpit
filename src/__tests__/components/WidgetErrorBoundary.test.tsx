import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WidgetErrorBoundary } from "@/components/WidgetErrorBoundary";

function Boom(): never {
  throw new Error("boom");
}

describe("WidgetErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children normally when no error is thrown", () => {
    render(
      <WidgetErrorBoundary>
        <div>All good</div>
      </WidgetErrorBoundary>
    );
    expect(screen.getByText("All good")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("catches errors thrown during render and shows the error message", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <WidgetErrorBoundary>
        <Boom />
      </WidgetErrorBoundary>
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("widget-error");
    expect(alert).toHaveTextContent("boom");
  });

  it("prefixes the error message with the widgetType when provided", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <WidgetErrorBoundary widgetType="plex">
        <Boom />
      </WidgetErrorBoundary>
    );
    expect(screen.getByRole("alert")).toHaveTextContent("[plex] boom");
  });
});
