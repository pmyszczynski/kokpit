import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WidgetStatGrid } from "./WidgetStatGrid";

describe("WidgetStatGrid", () => {
  it("keeps caller content, classes, and div accessibility attributes", () => {
    render(
      <WidgetStatGrid className="immich-stats-widget__grid" aria-label="Immich metrics">
        <span>Storage</span>
        <span>Items</span>
      </WidgetStatGrid>
    );

    const grid = screen.getByLabelText("Immich metrics");

    expect(grid).toHaveClass(
      "widget-ui",
      "widget-stat-grid",
      "immich-stats-widget__grid"
    );
    expect(grid).toHaveTextContent("Storage");
    expect(grid).toHaveTextContent("Items");
  });

  it.each([1, 2, 3, 4] as const)("marks the requested %i-column layout", (columns) => {
    const { container } = render(<WidgetStatGrid columns={columns}>Metrics</WidgetStatGrid>);

    expect(container.firstElementChild).toHaveAttribute("data-columns", String(columns));
  });

  it("defaults to two columns", () => {
    const { container } = render(<WidgetStatGrid>Metrics</WidgetStatGrid>);

    expect(container.firstElementChild).toHaveAttribute("data-columns", "2");
  });
});
