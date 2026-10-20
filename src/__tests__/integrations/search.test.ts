// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { fetchSearch, SearchConfigSchema } from "@/integrations/search/api";
import { getWidget } from "@/widgets";
import { splitWidgetConfig } from "@/widgets/configBoundary";
import "@/integrations/search/widget";

describe("Search configuration and native destination", () => {
  it("uses DuckDuckGo defaults without an integration or background polling", async () => {
    expect(await fetchSearch({})).toEqual({ action: "https://duckduckgo.com/", parameters: [], queryParameter: "q", engineName: "DuckDuckGo", newTab: true });
    expect(getWidget("search")).toMatchObject({ integrationType: null, refreshInterval: 0, supportsConnectionTest: false, sharedUI: true, hasLinks: true, preferredSize: "wide", supportedFootprints: [{ label: "Wide", columnSpan: 6, rowSpan: 2 }, { label: "Compact", columnSpan: 3, rowSpan: 2 }] });
    expect(splitWidgetConfig("search", { search_url: "https://search.example/search", query_parameter: "query" })).toEqual({ connection: {}, options: { search_url: "https://search.example/search", query_parameter: "query" } });
  });
  it("preserves fixed/repeated parameters and replaces all existing query values", async () => {
    expect(await fetchSearch({ search_url: "https://search.example/profile/search?language=en&category=it&category=science&query=old&query=older", query_parameter: "query", engine_name: "Home search", new_tab: false })).toEqual({ action: "https://search.example/profile/search", parameters: [["language", "en"], ["category", "it"], ["category", "science"]], queryParameter: "query", engineName: "Home search", newTab: false });
  });
  it("supports browser-reachable HTTP LAN endpoints, encoded path characters and IPv6", async () => {
    expect((await fetchSearch({ search_url: "http://[::1]:8080/search%23section?language=pl" })).action).toBe("http://[::1]:8080/search%23section");
    expect((await fetchSearch({ search_url: "https://www.google.com/search" })).engineName).toBe("Google");
  });
  it.each(["constructor", "__proto__"])("uses a plain host label for the self-hosted endpoint %s", async hostname => {
    expect((await fetchSearch({ search_url: `http://${hostname}/search` })).engineName).toBe(hostname);
  });
  it.each(["javascript:alert(1)", "data:text/html,hello", "ftp://example.com/", "/search", "https://me:secret@example.com/", "https://example.com/#", "https://example.com/#query"])("rejects unsafe or ambiguous engine URLs: %s", search_url => {
    expect(SearchConfigSchema.safeParse({ search_url }).success).toBe(false);
  });
  it.each(["", "q&x", "q=", "q#", "q?", "a b", "q\nname"])("rejects ambiguous parameter names: %j", query_parameter => {
    expect(SearchConfigSchema.safeParse({ query_parameter }).success).toBe(false);
  });
  it("normalizes surrounding whitespace and retains valid structured parameter names", async () => {
    expect(await fetchSearch({ search_url: " https://example.com/ ", query_parameter: " search[query] ", engine_name: " My engine " })).toMatchObject({ action: "https://example.com/", queryParameter: "search[query]", engineName: "My engine" });
  });
  it("never fetches the engine while resolving options and propagates cancellation", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    try { await fetchSearch({}); expect(spy).not.toHaveBeenCalled(); } finally { spy.mockRestore(); }
    const controller = new AbortController(); controller.abort();
    await expect(fetchSearch({}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
