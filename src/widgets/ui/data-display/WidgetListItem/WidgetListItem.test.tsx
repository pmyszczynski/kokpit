import { render, screen } from "@testing-library/react";
import { describe, it, expect, expectTypeOf } from "vitest";
import { WidgetListItem, type WidgetListItemProps } from "./WidgetListItem";
describe("WidgetListItem", () => {
 it("uses named content slots instead of accepting discarded children", () => {
  expectTypeOf<WidgetListItemProps>().not.toHaveProperty("children");
 });
 it("retains full title and secondary text with caller accessories", () => {
  render(<ul><WidgetListItem title="A very long full title" secondary="Requesting person" leading="pending" trailing="2h ago" /></ul>);
  expect(screen.getByRole("listitem")).toHaveTextContent("pendingA very long full titleRequesting person2h ago");
  expect(screen.getByText("A very long full title")).toHaveAttribute("title","A very long full title");
  expect(screen.getByText("Requesting person")).toHaveAttribute("title","Requesting person");
 });
 it("allows caller formatted title content and optional slots", () => {
  render(<ul><WidgetListItem title={<strong>Formatted title</strong>} titleTooltip="Complete formatted title" secondary={<em>Requester</em>} secondaryTooltip="Full requesting person" /></ul>);
  expect(screen.getByText("Formatted title").closest("span")).toHaveAttribute("title", "Complete formatted title");
  expect(screen.getByText("Requester").closest("span")).toHaveAttribute("title", "Full requesting person");
 });
 it("preserves full column content and explicit field meanings", () => {
  render(<ul><WidgetListItem title="Movie" columns={[
   { content: "73%" }, { content: "Waiting for import with a warning", tone: "warning" }, { content: "2 days, 01:23:45" },
  ]} /></ul>);
  expect(screen.getByRole("listitem")).toHaveClass("widget-list-item--columns");
  expect(screen.getByText("Waiting for import with a warning")).toHaveClass("widget-list-item__column--tone-warning");
  expect(screen.getByText("2 days, 01:23:45")).toBeInTheDocument();
 });
});
