// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRss, RssConfigSchema } from "@/integrations/rss/api";
import { parseFeed, fetchFeed } from "@/integrations/rss/server";
import { ssrfSafeFetch } from "@/lib/ssrfGuard";
import { getWidget } from "@/widgets";
import { splitWidgetConfig } from "@/widgets/configBoundary";
import "@/integrations/rss/widget";

vi.mock("@/lib/ssrfGuard", () => ({ ssrfSafeFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const config = { feed_url: "https://example.com/feed.xml" };
const RSS = `<rss version="2.0"><channel><title>Homelab &amp; News</title><item><title><![CDATA[Storage &amp; backups]]></title><link>/posts/storage</link><pubDate>Fri, 16 Oct 2026 10:30:00 GMT</pubDate><description><![CDATA[<p>Keep <b>three</b> copies.</p><script>evil()</script>]]></description></item><item><title>Next</title></item></channel></rss>`;
function respond(body = RSS, options: ResponseInit = {}) {
  const response = new Response(body, options); vi.mocked(ssrfSafeFetch).mockResolvedValue(response); return response;
}
describe("RSS and Atom parsing", () => {
  it("normalizes RSS, CDATA, entities, markup, dates and relative links", () => {
    expect(parseFeed(RSS, config.feed_url, 10)).toEqual({ title: "Homelab & News", articles: [
      { title: "Storage & backups", url: "https://example.com/posts/storage", publishedAt: "2026-10-16T10:30:00.000Z", summary: "Keep three copies." },
      { title: "Next", url: null, publishedAt: null, summary: "" },
    ] });
  });
  it("treats HTML doctypes in CDATA and declarations in comments as inert text", () => {
    const xml = '<rss><channel><!-- <!DOCTYPE harmless> --><title>Feed</title><item><title>News</title><description><![CDATA[<!DOCTYPE html><p>A normal article.</p>]]></description></item></channel></rss>';
    expect(parseFeed(xml, config.feed_url, 10).articles[0].summary).toBe("A normal article.");
  });
  it("still rejects a real DTD after inert text instead of rewriting its input", () => {
    const xml = '<!-- <!DOCTYPE harmless> --><!DOCTYPE rss [<!ENTITY external SYSTEM "file:///etc/passwd">]><rss><channel><title>Feed</title></channel></rss>';
    expect(() => parseFeed(xml, config.feed_url, 10)).toThrow(expect.objectContaining({ diagnostic: { integration: "rss", stage: "xml", retryable: false } }));
  });
  it("handles Atom namespaces, alternate links, inherited xml:base, XHTML and updated dates", () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://news.example.org/"><title>Updates</title><entry xml:base="posts/"><title type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">Release <b>one</b></div></title><link rel="self" href="api.xml"/><link rel="alternate" href="one"/><updated>2026-10-16T12:00:00+02:00</updated><summary type="xhtml"><div><p>A <b>small</b> update.</p></div></summary></entry></feed>`;
    expect(parseFeed(xml, config.feed_url, 10).articles[0]).toEqual({ title: "Release one", url: "https://news.example.org/posts/one", publishedAt: "2026-10-16T10:00:00.000Z", summary: "A small update." });
  });
  it("applies a relative Atom feed base exactly once", () => {
    const xml = '<feed xml:base="../articles/"><title>Feed</title><entry><title>Article</title><link href="one"/></entry></feed>';
    expect(parseFeed(xml, "https://example.org/feeds/current.xml", 10).articles[0].url).toBe("https://example.org/articles/one");
  });
  it("supports RSS 1.0 RDF and dc:date", () => {
    const xml = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>RDF</title></channel><item><title>News</title><link>https://example.com/item</link><dc:date>2026-10-16T10:00:00Z</dc:date></item></rdf:RDF>`;
    expect(parseFeed(xml, config.feed_url, 1).articles[0]).toMatchObject({ title: "News", publishedAt: "2026-10-16T10:00:00.000Z" });
  });
  it("uses RSS 1.0 channel sequence order before limiting, resolving sibling item bases independently", () => {
    const xml = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xml:base="https://example.org/"><channel xml:base="channel/"><title>RDF</title><items><rdf:Seq xml:base="../articles/"><rdf:li rdf:resource="second"/><rdf:li rdf:resource="first"/></rdf:Seq></items></channel><item rdf:about="articles/first"><title>First</title><link>articles/first</link></item><item xml:base="articles/" rdf:about="second"><title>Second</title><link>second</link></item></rdf:RDF>`;
    expect(parseFeed(xml, config.feed_url, 1).articles).toEqual([{ title: "Second", url: "https://example.org/articles/second", publishedAt: null, summary: "" }]);
    expect(parseFeed(xml, config.feed_url, 10).articles.map(item => item.title)).toEqual(["Second", "First"]);
  });
  it("retains feed order and enforces the article limit without changing dates", () => {
    expect(parseFeed(RSS, config.feed_url, 1).articles.map(a => a.title)).toEqual(["Storage & backups"]);
  });
  it.each(["javascript:alert(1)", "data:text/html,evil", "file:///etc/passwd", "https://user:secret@example.com/"])("removes unsafe article link %s", url => {
    expect(parseFeed(`<rss><channel><title>Feed</title><item><link>${url}</link></item></channel></rss>`, config.feed_url, 10).articles[0]).toMatchObject({ title: "Untitled article", url: null, publishedAt: null });
  });
  it("keeps empty feeds distinct from invalid documents and preserves numeric-looking titles", () => {
    expect(parseFeed("<feed><title>007</title></feed>", config.feed_url, 10)).toEqual({ title: "007", articles: [] });
    expect(parseFeed("<rss><channel><item><title>0</title><pubDate>bad</pubDate></item></channel></rss>", config.feed_url, 10).articles[0]).toMatchObject({ title: "0", publishedAt: null });
  });
  it.each(["<html><body>Error</body></html>", "<rss><channel></rss>", '<!DOCTYPE rss [<!ENTITY boom "evil">]><rss><channel><title>&boom;</title></channel></rss>', `<rss><channel>${"<a>".repeat(50)}text${"</a>".repeat(50)}</channel></rss>`])("rejects malformed/non-feed XML, DTDs and excessive nesting", xml => {
    expect(() => parseFeed(xml, config.feed_url, 10)).toThrow(expect.objectContaining({ code: "widget_invalid_response" }));
  });
});
describe("RSS fetching and registration", () => {
  it("uses validated destinations, forwards cancellation and defaults to ten articles", async () => {
    respond(); const signal = new AbortController().signal;
    const result = await fetchRss(config, signal);
    expect(result.articles).toHaveLength(2);
    expect(ssrfSafeFetch).toHaveBeenCalledWith(config.feed_url, expect.objectContaining({ allowPrivateNetworks: false, signal, headers: expect.objectContaining({ Accept: expect.stringContaining("application/atom+xml") }) }));
  });
  it("resolves relative links against the final validated response URL after redirects", async () => {
    const response = respond(); Object.defineProperty(response, "url", { value: "https://redirect.example.org/feeds/news.xml" });
    expect((await fetchFeed(config)).articles[0].url).toBe("https://redirect.example.org/posts/storage");
  });
  it.each([400, 429, 503])("classifies HTTP %s and cancels the body", async status => {
    const response = respond("private upstream detail", { status }); const cancel = vi.spyOn(response.body!, "cancel");
    await expect(fetchFeed(config)).rejects.toMatchObject({ code: "widget_upstream_error", diagnostic: { upstreamStatus: status, retryable: status === 429 || status >= 500 } });
    expect(cancel).toHaveBeenCalled();
  });
  it("bounds failures without echoing upstream URLs or content and preserves aborts", async () => {
    vi.mocked(ssrfSafeFetch).mockRejectedValue(new Error("private URL or upstream detail"));
    await expect(fetchFeed(config)).rejects.toMatchObject({ message: "Widget integration failure", code: "widget_upstream_unreachable" });
    vi.mocked(ssrfSafeFetch).mockRejectedValue(new DOMException("Aborted", "AbortError"));
    await expect(fetchFeed(config)).rejects.toMatchObject({ name: "AbortError" });
  });
  it.each([true, false])("rejects oversized bodies with/without a content-length: %s", async declared => {
    const response = respond("x".repeat(2 * 1024 * 1024 + 1), declared ? { headers: { "content-length": String(2 * 1024 * 1024 + 1) } } : {});
    await expect(fetchFeed(config)).rejects.toMatchObject({ diagnostic: { stage: "size" } });
    expect(response.body!.locked).toBe(false);
  });
  it.each([{ feed_url: "" }, { feed_url: "file:///etc/passwd" }, { feed_url: "https://user:secret@example.com" }, { max_items: 0 }, { max_items: 51 }, { max_items: 1.2 }, { max_items: "5" }])("rejects invalid configuration %j before networking", async overrides => {
    await expect(fetchFeed({ ...config, ...overrides } as typeof config)).rejects.toThrow(); expect(ssrfSafeFetch).not.toHaveBeenCalled();
  });
  it("stores feed options per tile and declares a shared linked list at three distinct sizes", () => {
    const widget = getWidget("rss")!;
    expect(RssConfigSchema.parse(config)).toEqual({ ...config, max_items: 10 });
    expect(widget).toMatchObject({ integrationType: null, sharedUI: true, hasLinks: true, refreshInterval: 600_000 });
    expect(splitWidgetConfig("rss", config)).toEqual({ connection: {}, options: config });
    expect(widget.supportedFootprints).toEqual([{ label: "Compact", columnSpan: 3, rowSpan: 3 }, { label: "Wide", columnSpan: 6, rowSpan: 3 }, { label: "Detailed", columnSpan: 6, rowSpan: 4 }]);
  });
});
