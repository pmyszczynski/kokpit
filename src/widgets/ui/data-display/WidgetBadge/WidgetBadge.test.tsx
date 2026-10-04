import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { WidgetBadge } from "./WidgetBadge";
describe("WidgetBadge", () => {
 it("keeps the visible domain label and caller attributes with a semantic tone", () => {
  render(<WidgetBadge tone="warning" className="consumer-badge" title="Awaiting approval">pending</WidgetBadge>);
  expect(screen.getByText("pending")).toHaveClass("widget-badge--tone-warning", "consumer-badge");
  expect(screen.getByText("pending")).toHaveAttribute("title","Awaiting approval");
 });
});
