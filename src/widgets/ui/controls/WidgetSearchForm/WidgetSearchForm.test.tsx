import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WidgetSearchForm } from "./WidgetSearchForm";

const props = { action: "https://search.example/search", queryParameter: "query", label: "Search with Home search" };
describe("WidgetSearchForm", () => {
  it("uses native GET semantics, accessible controls, fixed parameters and protected new-tab behavior", () => {
    render(<WidgetSearchForm {...props} parameters={[["language", "pl"], ["category", "it"], ["category", "science"], ["query", "obsolete"]]} />);
    const form = screen.getByRole("search", { name: props.label });
    expect(form).toHaveAttribute("action", props.action); expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("target", "_blank"); expect(form).toHaveAttribute("rel", "noopener noreferrer");
    const input = screen.getByRole("searchbox", { name: "Search query" }); expect(input).toHaveAttribute("name", "query"); expect(input).toHaveAttribute("maxlength", "500");
    expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute("type", "submit");
    expect([...new FormData(form as HTMLFormElement).entries()]).toEqual([["language", "pl"], ["category", "it"], ["category", "science"], ["query", ""]]);
  });
  it("blocks whitespace-only submissions and clears validity as the user types", () => {
    render(<WidgetSearchForm {...props} newTab={false} />);
    const input = screen.getByRole("searchbox", { name: "Search query" }) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "   " } });
    expect(fireEvent.submit(screen.getByRole("search"))).toBe(false);
    expect(input.validationMessage).toBe("Enter a search query.");
    fireEvent.input(input, { target: { value: "  café & C++ #home  " } });
    expect(input.validationMessage).toBe("");
    const form = screen.getByRole("search"); form.addEventListener("submit", event => event.preventDefault()); fireEvent.submit(form);
    expect(input.value).toBe("café & C++ #home"); expect(form).toHaveAttribute("target", "_self");
  });
});
