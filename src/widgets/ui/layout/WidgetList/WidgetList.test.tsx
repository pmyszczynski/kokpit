import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { WidgetList } from "./WidgetList";
describe("WidgetList", () => {
 it("keeps fixed slots outside the named focusable list", () => {
  render(<WidgetList label="Recent items" header="Summary" footer="Total"><li>Item</li></WidgetList>);
  const list=screen.getByRole("list", {name:"Recent items"});
  expect(list).toHaveAttribute("tabindex","0");
  expect(list).toHaveTextContent("Item");
  expect(list).not.toHaveTextContent("Summary");
  expect(list).not.toHaveTextContent("Total");
 });
 it("shows caller empty content without an empty scroll target", () => {
  render(<WidgetList label="Recent items" empty="No items" />);
  expect(screen.getByText("No items")).toBeInTheDocument();
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
 });
});
