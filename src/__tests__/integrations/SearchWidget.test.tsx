import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SearchWidget } from "@/integrations/search/widget";
const data = { action: "https://duckduckgo.com/", parameters: [] as [string, string][], queryParameter: "q", engineName: "DuckDuckGo", newTab: true };
const props = { data, loading: false, error: null, refresh: () => {} };
describe("Search shared UI", () => {
  it("uses the shared form and keeps provider/destination details", () => {
    const { container } = render(<SearchWidget {...props} />);
    expect(screen.getByRole("search", { name: "Search with DuckDuckGo" })).toBeInTheDocument();
    expect(screen.getByText("DuckDuckGo · Opens in a new tab")).toHaveAttribute("title", "DuckDuckGo · https://duckduckgo.com/");
    expect(container.querySelector(".widget-body .widget-search-form")).toBeInTheDocument();
  });
  it("retains typed input during a failed config refresh", () => {
    const { rerender } = render(<SearchWidget {...props} />); const input = screen.getByRole("searchbox") as HTMLInputElement; input.value = "my query";
    rerender(<SearchWidget {...props} error="Options unavailable" />);
    expect(screen.getByRole("alert")).toHaveAttribute("title", "Options unavailable"); expect(screen.getByRole("searchbox")).toHaveValue("my query");
  });
  it.each([null, { ...data, action: "javascript:alert(1)" }])("does not render an invalid or missing search destination", invalid => {
    render(<SearchWidget {...props} data={invalid} />); expect(screen.queryByRole("search")).toBeNull(); expect(screen.getByRole("alert")).toHaveTextContent("Search unavailable");
  });
});
