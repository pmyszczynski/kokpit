import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { WidgetStatRow } from "./WidgetStatRow";
import { WidgetBar } from "../WidgetBar";

describe("WidgetStatRow", () => {
  it("keeps formatted zero values, subvalues, tooltips and a named usage meter", () => {
    render(<WidgetStatRow label="Memory" value={0} subValue="/ 16 GiB" tone="info" title="16 GiB available" className="memory-row" data-testid="measurement"
      bar={<WidgetBar kind="usage" label="Memory usage" value={0} valueText="0 of 16 GiB" />} />);
    expect(screen.getByTestId("measurement")).toHaveClass("widget-ui", "widget-stat-row", "memory-row");
    expect(screen.getByTestId("measurement")).toHaveAttribute("title", "16 GiB available");
    expect(screen.getByText("0")).toHaveTextContent("0 / 16 GiB");
    expect(screen.getByRole("meter", { name: "Memory usage" })).toHaveAttribute("aria-valuetext", "0 of 16 GiB");
  });
  it("retains distinct grouped measurements and omits absent values without placeholders", () => {
    const { rerender, container } = render(<WidgetStatRow label="Network" values={[
      { content: "↓ 1.2 MB/s", tone: "positive", className: "download" },
      { content: "↑ 240 KB/s", tone: "info", title: "Outgoing data" },
    ]} />);
    expect(screen.getByText("↓ 1.2 MB/s")).toHaveClass("widget-stat-row__value--tone-positive", "download");
    expect(screen.getByText("↑ 240 KB/s")).toHaveAttribute("title", "Outgoing data");
    rerender(<WidgetStatRow label="Docker" detail={<span title="Socket unavailable">Docker unavailable</span>} />);
    expect(screen.getByText("Docker unavailable")).toHaveAttribute("title", "Socket unavailable");
    expect(container.querySelector(".widget-stat-row__value")).not.toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });
});
