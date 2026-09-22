import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WidgetStat } from "./WidgetStat";

describe("WidgetStat", () => {
  it("keeps zero values and exposes the label/value definition pair", () => {
    render(<WidgetStat label="Queued items" value={0} />);

    const label = screen.getByText("Queued items");
    const value = screen.getByText("0");

    expect(label.tagName).toBe("DT");
    expect(value.tagName).toBe("DD");
    expect(label.closest("dl")).toContainElement(value);
  });

  it("renders caller-provided React content without formatting it", () => {
    render(
      <WidgetStat
        label={<span>Storage used</span>}
        value={<strong>1.5 GB</strong>}
        tone="positive"
      />
    );

    expect(screen.getByText("Storage used")).toBeInTheDocument();
    expect(screen.getByText("1.5 GB").tagName).toBe("STRONG");
    expect(screen.getByText("1.5 GB").closest(".widget-stat")).toHaveClass(
      "widget-stat--tone-positive"
    );
  });

  it("keeps caller class hooks on the card, value, and label slots", () => {
    render(
      <WidgetStat
        label="Photos"
        value="12,345"
        className="immich-stats-widget__stat"
        valueClassName="immich-stats-widget__value"
        labelClassName="immich-stats-widget__label"
      />
    );

    expect(screen.getByText("12,345")).toHaveClass(
      "widget-stat__value",
      "immich-stats-widget__value"
    );
    expect(screen.getByText("Photos")).toHaveClass(
      "widget-stat__label",
      "immich-stats-widget__label"
    );
    expect(screen.getByText("Photos").closest(".widget-stat")).toHaveClass(
      "immich-stats-widget__stat"
    );
  });

});
