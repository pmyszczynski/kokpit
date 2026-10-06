import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { WidgetStatusDot } from "./WidgetStatusDot";

describe("WidgetStatusDot", () => {
  it("names a static state without announcing every poll", () => {
    render(<WidgetStatusDot label="restarting" tone="warning" className="consumer-dot" />);
    const dot = screen.getByRole("img", { name: "restarting" });
    expect(dot).toHaveAttribute("title", "restarting");
    expect(dot).not.toHaveAttribute("aria-live");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("retains the caller's tooltip and attributes without changing the accessible state", () => {
    render(<WidgetStatusDot label="running" tone="positive" title="Up 3 days" id="container-state" />);
    const dot = screen.getByRole("img", { name: "running" });
    expect(dot).toHaveAttribute("title", "Up 3 days");
    expect(dot).toHaveAttribute("id", "container-state");
  });
});
