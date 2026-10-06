import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { WidgetList } from "./WidgetList";
describe("WidgetList", () => {
 it("keeps fixed slots outside the named focusable list", () => {
  render(<WidgetList label="Recent items" header="Summary" footer="Total"><li>Item</li></WidgetList>);
  const list=screen.getByRole("list", {name:"Recent items"});
  expect(screen.getByText("Summary")).toBeVisible();
  expect(screen.getByText("Total")).toBeVisible();
  expect(list).not.toContainElement(screen.getByText("Summary"));
  expect(list).not.toContainElement(screen.getByText("Total"));
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
 it("keeps column labels fixed outside the list and omits them for empty data", () => {
  const { rerender } = render(<WidgetList label="Downloads" header="Summary" columnsClassName="download-columns" columnLabels={["Name", "Progress", "Status", "ETA"]}><li>Download</li></WidgetList>);
  expect(screen.getByText("Progress")).toBeVisible();
  expect(screen.getByText("Progress").parentElement).toHaveClass("download-columns");
  expect(screen.getByText("Summary")).not.toHaveClass("download-columns");
  expect(screen.getByRole("list")).not.toContainElement(screen.getByText("Progress"));
  rerender(<WidgetList label="Downloads" columnLabels={["Name", "Progress", "Status", "ETA"]} empty="Queue is empty" />);
  expect(screen.queryByText("Progress")).not.toBeInTheDocument();
 });
 it("retains caller summary content outside the list, including zero values and empty data", () => {
  const summary = { primary: 0, secondary: "4 total", className: "consumer-summary", secondaryClassName: "consumer-total" };
  const { rerender } = render(<WidgetList label="Containers" summary={summary}><li>Container</li></WidgetList>);
  expect(screen.getByRole("list")).not.toContainElement(screen.getByText("4 total"));
  expect(screen.getByText("0")).toBeVisible();
  rerender(<WidgetList label="Containers" summary={summary} empty="No running containers" />);
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
  expect(screen.getByText("4 total")).toBeVisible();
 });

});
