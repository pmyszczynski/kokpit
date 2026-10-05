import { render, screen } from "@testing-library/react";
import { describe, it, expect, expectTypeOf } from "vitest";
import type { ReactElement } from "react";
import { WidgetBar, type WidgetBarProps } from "./WidgetBar";

describe("WidgetBar", () => {
  it("requires equivalent accessible text for rich labels", () => {
    expectTypeOf<{ label: string; value: number; valueLabel: ReactElement }>().not.toExtend<WidgetBarProps>();
    expectTypeOf<{ label: string; value: number; valueLabel: ReactElement; valueText: string }>().toExtend<WidgetBarProps>();
    expectTypeOf<{ label: string; value: number; valueLabel: string }>().toExtend<WidgetBarProps>();
  });
  it("names task progress and retains visible formatted values", () => {
    render(<WidgetBar label="Episode download" value={73} valueLabel="73%" tone="positive" />);
    const bar = screen.getByRole("progressbar", { name: "Episode download" });
    expect(bar).toHaveAttribute("aria-valuenow", "73");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuetext", "73%");
    expect(screen.getByText("73%")).toBeVisible();
    expect(bar.firstElementChild).toHaveStyle({ width: "73%" });
  });
  it.each([-20, 120])("clamps usage fill but retains the domain value %s", value => {
    render(<WidgetBar kind="usage" label="Budget used" value={value} valueLabel={`${value}%`} />);
    const meter = screen.getByRole("meter", { name: "Budget used" });
    const bounded = value < 0 ? 0 : 100;
    expect(meter).toHaveAttribute("aria-valuenow", String(bounded));
    expect(meter).toHaveAttribute("aria-valuetext", `${value}%`);
    expect(meter.firstElementChild).toHaveStyle({ width: `${bounded}%` });
    expect(screen.getByText(`${value}%`)).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
  it("normalizes a non-percentage range and accepts rich domain labels", () => {
    render(<WidgetBar kind="usage" label="Space used" min={20} max={60} value={40} valueText="40 GB of 60 GB" valueLabel={<strong>40 GB</strong>} />);
    const meter = screen.getByRole("meter");
    expect(meter.firstElementChild).toHaveStyle({ width: "50%" });
    expect(meter).toHaveAttribute("aria-valuetext", "40 GB of 60 GB");
    expect(screen.getByText("40 GB")).toBeVisible();
  });
  it.each([null, NaN, Infinity])("keeps unknown task progress distinct from zero (%s)", value => {
    render(<WidgetBar label="Download" value={value} />);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Unknown progress");
  });
  it.each([0, 100])("retains exact terminal progress %s", value => {
    render(<WidgetBar label="Download" value={value} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(value));
  });
  it("rejects invalid ranges and unknown usage readings", () => {
    expect(() => render(<WidgetBar label="Download" value={20} min={100} max={0} />)).toThrow(RangeError);
    expect(() => render(<WidgetBar label="Usage" kind="usage" value={NaN} />)).toThrow(RangeError);
  });
});
