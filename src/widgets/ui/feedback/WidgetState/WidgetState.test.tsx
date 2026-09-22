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

  it.each(["empty", "error"] as const)(
    "does not render an absent %s state",
    (state) => {
      const { container, rerender } = render(<WidgetState state={state} />);

      expect(container).toBeEmptyDOMElement();

      rerender(<WidgetState state={state}>{null}</WidgetState>);
      expect(container).toBeEmptyDOMElement();
    }
  );

  it("renders meaningful empty-state content", () => {
    render(<WidgetState state="empty">No items</WidgetState>);

    expect(screen.getByText("No items")).not.toHaveAttribute("role");
    expect(screen.getByText("No items").closest(".widget-state")).toHaveClass(
      "widget-state--empty"
    );
  });

  it.each(["empty", "error"] as const)("renders zero for %s states", (state) => {
    render(<WidgetState state={state}>{0}</WidgetState>);

    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders loading even without content", () => {
    render(<WidgetState state="loading" />);

    expect(screen.getByRole("status", { name: "Loading widget" })).toBeInTheDocument();
  });
});
