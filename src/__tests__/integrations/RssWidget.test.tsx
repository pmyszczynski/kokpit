import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RssWidget } from "@/integrations/rss/widget";
import type { RssData } from "@/integrations/rss/api";
const data: RssData = { title: "Homelab News", articles: [{ title: "Release one", url: "https://example.com/one", publishedAt: "2026-10-16T10:00:00.000Z", summary: "A small update." }, { title: "No link", url: null, publishedAt: null, summary: "" }] };
const props = { data, loading: false, error: null, refresh: () => {} };
describe("RssWidget", () => {
  it.each([[3, 3], [6, 3], [6, 4]])("shows all articles and dates at %s×%s, with summaries only in Detailed", (columnSpan, rowSpan) => {
    render(<RssWidget {...props} footprint={{ columnSpan, rowSpan }} />);
    expect(screen.getByRole("list", { name: "Feed articles" })).toHaveAttribute("tabindex", "0");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Homelab News")).toBeInTheDocument(); expect(screen.getByText("2 articles")).toBeInTheDocument();
    expect(screen.getByText("Oct 16, 2026")).toBeInTheDocument(); expect(screen.getByText("Date unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/A small update/)!==null).toBe(rowSpan === 4);
    expect(screen.getByRole("link", { name: "Release one" })).toHaveAttribute("rel", "noopener noreferrer");
  });
  it("retains saved articles with a refresh error", () => {
    render(<RssWidget {...props} error="Feed offline" />);
    expect(screen.getByRole("alert")).toHaveAccessibleName("Refresh failed; saved data is shown. Feed offline");
    expect(screen.getByRole("link", { name: "Release one" })).toBeInTheDocument();
  });
  it("retains a focused article's DOM identity when refresh prepends entries", () => {
    const { rerender } = render(<RssWidget {...props} />);
    const link = screen.getByRole("link", { name: "Release one" }); link.focus();
    rerender(<RssWidget {...props} data={{ ...data, articles: [{ ...data.articles[0], title: "New article", url: "https://example.com/new" }, ...data.articles] }} />);
    expect(screen.getByRole("link", { name: "Release one" })).toBe(link);
    expect(link).toHaveFocus(); expect(link).toHaveAttribute("href", "https://example.com/one");
  });
  it.each([true, false])("keeps focus on the same article when a new article shares its URL, native ID: %s", nativeId => {
    const original = { ...data.articles[0], ...(nativeId ? { id: "original-id" } : {}) };
    const { rerender } = render(<RssWidget {...props} data={{ ...data, articles: [original] }} />);
    const link = screen.getByRole("link", { name: original.title }); link.focus();
    const added = { ...original, title: "Another story at the same URL", ...(nativeId ? { id: "new-id" } : {}) };
    rerender(<RssWidget {...props} data={{ ...data, articles: [added, original] }} />);
    expect(screen.getByRole("link", { name: original.title })).toBe(link); expect(link).toHaveFocus();
  });
  it("exposes the full feed name through its tooltip when the fixed summary truncates", () => {
    const title = "A long feed name ".repeat(12).trim();
    render(<RssWidget {...props} data={{ ...data, title }} />);
    expect(screen.getByTitle(title)).toHaveTextContent(title.trim());
  });
  it("renders untrusted data as text and declines unsafe links", () => {
    const { container } = render(<RssWidget {...props} data={{ title: "Feed", articles: [{ title: "<img src=x onerror=evil()>", url: "javascript:evil()", publishedAt: "broken", summary: "<script>evil()</script>" }] }} footprint={{ columnSpan: 6, rowSpan: 4 }} />);
    expect(container.querySelector("img, script, a")).toBeNull(); expect(screen.getByText("Date unavailable", { exact: false })).toBeInTheDocument();
  });
  it("keeps valid empty feeds separate from unavailable data", () => {
    render(<RssWidget {...props} data={{ title: "Feed", articles: [] }} />);
    expect(screen.getByText("No articles in this feed")).toBeInTheDocument(); expect(screen.getByText("0 articles")).toBeInTheDocument();
  });
  it.each([[true, null, "status"], [false, "Feed offline", "alert"]] as const)("uses shared initial feedback", (loading, error, role) => {
    render(<RssWidget {...props} data={null} loading={loading} error={error} />); expect(screen.getByRole(role)).toBeInTheDocument();
  });
  it("uses an explicit unavailable state", () => {
    render(<RssWidget {...props} data={null} />); expect(screen.getByText("Feed unavailable")).toBeInTheDocument();
  });
});
