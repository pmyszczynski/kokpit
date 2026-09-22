import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WidgetState } from "./WidgetState";

describe("WidgetState", () => {
  it("exposes loading semantics while hiding its decorative spinner", () => {
    render(<WidgetState state="loading">Loading library</WidgetState>);

    expect(screen.getByRole("status", { name: "Loading widget" })).toHaveClass(
      "widget-ui",
      "widget-state",
      "widget-state--loading"
    );
    expect(screen.getByText("Loading library")).toBeInTheDocument();
    expect(document.querySelector(".widget-state__spinner")).toHaveAttribute(
      "aria-hidden",
      "true"
    );
  });

  it("exposes error copy as an alert and retains caller class hooks", () => {
    render(
      <WidgetState state="error" className="immich-stats-widget__error">
        Connection refused
      </WidgetState>
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Connection refused");
    expect(screen.getByRole("alert")).toHaveClass("immich-stats-widget__error");
    expect(screen.getByText("Connection refused")).toHaveClass("widget-state__label");
  });

  it("does not invent meaningful empty-state content", () => {
    const { container, rerender } = render(<WidgetState state="empty" />);

    expect(container).toBeEmptyDOMElement();

    rerender(<WidgetState state="empty">No items</WidgetState>);
    expect(screen.getByText("No items")).not.toHaveAttribute("role");
    expect(screen.getByText("No items").closest(".widget-state")).toHaveClass(
      "widget-state--empty"
    );
  });
});
