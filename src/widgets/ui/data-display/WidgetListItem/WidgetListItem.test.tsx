import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { WidgetListItem } from "./WidgetListItem";
describe("WidgetListItem", () => {
 it("retains full title and secondary text with caller accessories", () => {
  render(<ul><WidgetListItem title="A very long full title" secondary="Requesting person" leading="pending" trailing="2h ago" /></ul>);
  expect(screen.getByRole("listitem")).toHaveTextContent("pendingA very long full titleRequesting person2h ago");
  expect(screen.getByText("A very long full title")).toHaveAttribute("title","A very long full title");
  expect(screen.getByText("Requesting person")).toHaveAttribute("title","Requesting person");
 });
 it("allows caller formatted title content and optional slots", () => {
  render(<ul><WidgetListItem title={<strong>Formatted title</strong>} /></ul>);
  expect(screen.getByText("Formatted title")).toBeInTheDocument();
 });
});
