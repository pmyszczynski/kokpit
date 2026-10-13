import { render, screen } from "@testing-library/react";
import { describe, expect, it, expectTypeOf } from "vitest";
import { WidgetStat } from "./WidgetStat";
import type { WidgetStatProps } from "./WidgetStat";

describe("WidgetStat", () => {
  it("owns its definition-list content while accepting ordinary attributes", () => {
    expectTypeOf<"children">().not.toExtend<keyof WidgetStatProps>();
    expectTypeOf<"dangerouslySetInnerHTML">().not.toExtend<keyof WidgetStatProps>();
    render(<WidgetStat label="Streaming" value={2} aria-label="Active streams" data-field="streams" />);
    expect(screen.getByLabelText("Active streams")).toHaveAttribute("data-field", "streams");
  });
  it("keeps supporting measurement details accessible through an optional value tooltip", () => {
    render(<WidgetStat label="Memory" value="20%" valueTooltip="3.2 / 16 GiB used" />);
    expect(screen.getByRole("definition")).toHaveAccessibleDescription("3.2 / 16 GiB used");
    expect(screen.getByRole("definition")).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tooltip", { hidden: true })).toHaveTextContent("3.2 / 16 GiB used");
  });
  it("keeps zero values and exposes the label/value definition pair", () => {
    render(<WidgetStat label="Queued items" value={0} />);

    const label = screen.getByText("Queued items");
    const value = screen.getByText("0");

    expect(label.tagName).toBe("DT");
    expect(value.tagName).toBe("DD");
    expect(value).not.toHaveAttribute("tabindex");
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

  it("keeps a supporting measurement separate from the main value and label", () => {
    const { container } = render(<WidgetStat label="Used (50%)" value="8.0 GiB" supportingValue="/ 16.0 GiB"
      supportingValueClassName="capacity-total" valueTooltip="8.0 GiB / 16.0 GiB (50%)" />);
    expect(screen.getByText("/ 16.0 GiB")).toHaveClass("widget-stat__supporting-value", "capacity-total");
    expect(container.querySelector("dd")).toHaveAccessibleDescription("8.0 GiB / 16.0 GiB (50%)");
    expect(screen.getByText("Used (50%)").tagName).toBe("DT");
  });
});
