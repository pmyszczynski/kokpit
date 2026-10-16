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
  it.each([true, false])("selects standard RSS fields independently of podcast extension order: %s", extensionFirst => {
    const titles = (standard: string) => extensionFirst ? `<itunes:title>Extension title</itunes:title><title>${standard}</title>` : `<title>${standard}</title><itunes:title>Extension title</itunes:title>`;
    const xml = `<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:body="http://purl.org/rss/1.0/modules/content/"><channel>${titles("Podcast")}<item>${titles("Episode")}<itunes:link>https://wrong.example.com/</itunes:link><link>https://example.com/episode</link><itunes:description>Wrong summary</itunes:description><body:encoded><![CDATA[<p>Real summary</p>]]></body:encoded></item></channel></rss>`;
    expect(parseFeed(xml, config.feed_url, 10)).toEqual({ title: "Podcast", articles: [{ title: "Episode", url: "https://example.com/episode", publishedAt: null, summary: "Real summary" }] });
  });
  it("selects prefixed Atom fields by namespace URI and ignores same-name extensions", () => {
    const xml = '<a:feed xmlns:a="http://www.w3.org/2005/Atom" xmlns:extra="https://example.com/ext"><extra:title>Wrong feed</extra:title><a:title>Atom feed</a:title><a:entry><extra:title>Wrong article</extra:title><a:title>Article</a:title><extra:id>Wrong ID</extra:id><a:id>urn:article:one</a:id><extra:content>Wrong body</extra:content><a:content type="text/html">&lt;p&gt;Real body&lt;/p&gt;</a:content><extra:link href="https://wrong.example.com/"/><a:link href="/article"/></a:entry></a:feed>';
    expect(parseFeed(xml, config.feed_url, 10)).toEqual({ title: "Atom feed", articles: [{ id: "urn:article:one", title: "Article", url: "https://example.com/article", publishedAt: null, summary: "Real body" }] });
  });
  it("recognizes arbitrary RDF, RSS, DC and content prefix aliases by namespace", () => {
    const xml = '<r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:s="http://purl.org/rss/1.0/" xmlns:c="http://purl.org/dc/elements/1.1/" xmlns:body="http://purl.org/rss/1.0/modules/content/"><s:channel><s:title>RDF feed</s:title><s:items><r:Seq><r:li r:resource="/two"/><r:li r:resource="/one"/></r:Seq></s:items></s:channel><s:item r:about="/one"><s:title>One</s:title></s:item><s:item r:about="/two"><s:title>Two</s:title><s:link>/two</s:link><c:date>2026-10-16T10:00:00Z</c:date><body:encoded><![CDATA[<p>Body two</p>]]></body:encoded></s:item></r:RDF>';
    expect(parseFeed(xml, config.feed_url, 1)).toEqual({ title: "RDF feed", articles: [{ id: "https://example.com/two", title: "Two", url: "https://example.com/two", publishedAt: "2026-10-16T10:00:00.000Z", summary: "Body two" }] });
  });
  it("normalizes RSS, CDATA, entities, markup, dates and relative links", () => {
    expect(parseFeed(RSS, config.feed_url, 10)).toEqual({ title: "Homelab & News", articles: [
      { title: "Storage & backups", url: "https://example.com/posts/storage", publishedAt: "2026-10-16T10:30:00.000Z", summary: "Keep three copies." },
      { title: "Next", url: null, publishedAt: null, summary: "" },
    ] });
  });
  it.each([
    '<rss><channel><title>2 &lt; 3 and 4 &gt; 1</title><item><title>2 &lt; 3 and 4 &gt; 1</title><description><![CDATA[<p>2 &lt; 3 and 4 &gt; 1</p>]]></description></item></channel></rss>',
    '<rss><channel><title>2 &lt; 3 and 4 &gt; 1</title><item><title>2 &lt; 3 and 4 &gt; 1</title><description>&lt;p&gt;2 &amp;lt; 3 and 4 &amp;gt; 1&lt;/p&gt;</description></item></channel></rss>',
    '<feed><title>2 &lt; 3 and 4 &gt; 1</title><entry><title>2 &lt; 3 and 4 &gt; 1</title><summary>2 &lt; 3 and 4 &gt; 1</summary></entry></feed>',
  ])("preserves escaped comparison text in titles and summaries", xml => {
    const data = parseFeed(xml, config.feed_url, 10);
    expect(data.title).toBe("2 < 3 and 4 > 1");
    expect(data.articles[0]).toMatchObject({ title: "2 < 3 and 4 > 1", summary: "2 < 3 and 4 > 1" });
  });
  it("keeps escaped tag names literal in plain Atom text and separates HTML blocks", () => {
    const xml = '<feed><title>Feed</title><entry><title>Use &lt;code&gt; tags</title><summary type="text">Write &lt;b&gt; as text.</summary></entry><entry><title>HTML</title><summary type="html">&lt;p&gt;One&lt;/p&gt;&lt;p&gt;Two&lt;/p&gt;</summary></entry></feed>';
    expect(parseFeed(xml, config.feed_url, 10).articles.map(a => [a.title, a.summary])).toEqual([["Use <code> tags", "Write <b> as text."], ["HTML", "One Two"]]);
  });
  it("preserves CDATA markup and entity spellings literally in Atom text constructs", () => {
    const xml = '<feed><title>Feed</title><entry><title type="text"><![CDATA[Use <code> &amp; examples]]></title><summary><![CDATA[Write <b> &amp; as text.]]></summary></entry></feed>';
    expect(parseFeed(xml, config.feed_url, 10).articles[0]).toMatchObject({ title: "Use <code> &amp; examples", summary: "Write <b> &amp; as text." });
  });
  it.each(["text/html", "TEXT/HTML", "text/html; charset=utf-8"])("extracts Atom content fallback with HTML MIME type %s", type => {
    const xml = `<feed><title>Feed</title><entry><title>Article</title><content type="${type}">&lt;p&gt;Available &lt;b&gt;content&lt;/b&gt; with 2 &amp;lt; 3&lt;/p&gt;</content></entry></feed>`;
    expect(parseFeed(xml, config.feed_url, 10).articles[0].summary).toBe("Available content with 2 < 3");
  });
  it.each(["application/xhtml+xml", "application/xml", "example/xml"])("extracts inline XML content fallback with MIME type %s", type => {
    const xml = `<feed><title>Feed</title><entry><title>Article</title><content type="${type}"><div xmlns="http://www.w3.org/1999/xhtml"><p>One</p><p>Two</p></div></content></entry></feed>`;
    expect(parseFeed(xml, config.feed_url, 10).articles[0].summary).toBe("One Two");
  });
  it("keeps Atom text/plain MIME content literal", () => {
    const xml = '<feed><title>Feed</title><entry><title>Article</title><content type="text/plain"><![CDATA[Write <code> &amp; as text.]]></content></entry></feed>';
    expect(parseFeed(xml, config.feed_url, 10).articles[0].summary).toBe("Write <code> &amp; as text.");
  });
  it.each(["text", "html"])("caps Atom %s source formatting before normalization and tries the next summary", type => {
    const xml = `<feed><title>Feed</title><entry><title>Article</title><summary type="${type}">${" ".repeat(65_536)}outside the formatting budget</summary><content type="text">Available fallback</content></entry></feed>`;
    expect(parseFeed(xml, config.feed_url, 10).articles[0].summary).toBe("Available fallback");
  });
  it("keeps bounded titles and summaries from splitting Unicode surrogate pairs", () => {
    const xml = `<feed><title>${"A".repeat(199)}😀</title><entry><title>${"B".repeat(499)}😀</title><summary>${"C".repeat(499)}😀</summary></entry></feed>`;
    const data = parseFeed(xml, config.feed_url, 10);
    expect(data.title).toBe("A".repeat(199));
    expect(data.articles[0]).toMatchObject({ title: "B".repeat(499), summary: "C".repeat(499) });
  });
  it.each(["", "not a date"])("uses valid fallback dates and non-empty fallback summaries after %j", published => {
    const xml = `<feed><title>Feed</title><entry><title>Article</title><published>${published}</published><updated>2026-10-16T10:00:00Z</updated><summary/><content type="html">&lt;p&gt;Available content&lt;/p&gt;</content></entry></feed>`;
    expect(parseFeed(xml, config.feed_url, 10).articles[0]).toMatchObject({ publishedAt: "2026-10-16T10:00:00.000Z", summary: "Available content" });
  });
  it("tries later summaries after markup-only content and later dates after invalid ones", () => {
    const xml = '<rss><channel><title>Feed</title><item><pubDate>bad</pubDate><date>2026-10-16T10:00:00Z</date><description><![CDATA[<script>ignore()</script><p> </p>]]></description><summary> </summary><encoded><![CDATA[<p>Available</p>]]></encoded></item></channel></rss>';
    expect(parseFeed(xml, config.feed_url, 10).articles[0]).toMatchObject({ publishedAt: "2026-10-16T10:00:00.000Z", summary: "Available" });
  });
  it.each([
    ['', 'https://example.com/post', 'https://example.com/post'],
    [' isPermaLink="true"', 'https://example.com/post', 'https://example.com/post'],
    [' isPermaLink="true"', '/post', null],
    ['', 'opaque-article-id', null],
    [' isPermaLink="false"', 'https://example.com/post', null],
    [' isPermaLink="true"', 'javascript:evil()', null],
    ['', 'https://user:secret@example.com/post', null],
    ['', '', null],
  ])("uses only safe permalink GUIDs when a link is absent: %s %s", (attribute, guid, url) => {
    expect(parseFeed(`<rss><channel><title>Feed</title><item><guid${attribute}>${guid}</guid></item></channel></rss>`, config.feed_url, 10).articles[0].url).toBe(url);
  });
  it("prefers an explicit safe link over a GUID and falls back after an unsafe link", () => {
    const xml = '<rss><channel><title>Feed</title><item><link>/preferred</link><guid>https://example.com/fallback</guid></item><item><link>javascript:evil()</link><guid>https://example.com/fallback</guid></item></channel></rss>';
    expect(parseFeed(xml, config.feed_url, 10).articles.map(a => a.url)).toEqual(["https://example.com/preferred", "https://example.com/fallback"]);
  });
  it("treats HTML doctypes in CDATA and declarations in comments as inert text", () => {
    const xml = '<rss><channel><!-- <!DOCTYPE harmless> --><title>Feed</title><item><title>News</title><description><![CDATA[<!DOCTYPE html><p>A normal article.</p>]]></description></item></channel></rss>';
    expect(parseFeed(xml, config.feed_url, 10).articles[0].summary).toBe("A normal article.");
  });
  it("still rejects a real DTD after inert text instead of rewriting its input", () => {
    const xml = '<!-- <!DOCTYPE harmless> --><!DOCTYPE rss [<!ENTITY external SYSTEM "file:///etc/passwd">]><rss><channel><title>Feed</title></channel></rss>';
    expect(() => parseFeed(xml, config.feed_url, 10)).toThrow(expect.objectContaining({ diagnostic: { integration: "rss", stage: "xml", retryable: false } }));
  });
  it("skips DTD-like processing-instruction text but still rejects a following real DTD", () => {
    const pi = '<?feed-note <!DOCTYPE harmless> ?>';
    const feed = '<rss><channel><title>Feed</title></channel></rss>';
    expect(parseFeed(pi + feed, config.feed_url, 10)).toEqual({ title: "Feed", articles: [] });
    expect(() => parseFeed(pi + '<!DOCTYPE rss [<!ENTITY external SYSTEM "file:///etc/passwd">]>' + feed, config.feed_url, 10)).toThrow(expect.objectContaining({ code: "widget_invalid_response" }));
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
    expect(parseFeed(xml, config.feed_url, 1).articles).toEqual([{ id: "https://example.org/articles/second", title: "Second", url: "https://example.org/articles/second", publishedAt: null, summary: "" }]);
    expect(parseFeed(xml, config.feed_url, 10).articles.map(item => item.title)).toEqual(["Second", "First"]);
  });
  it.each([
    ['<rss><channel><title>Feed</title><item><guid isPermaLink="false">article-123</guid><title>Article</title></item></channel></rss>', "article-123"],
    ['<feed><title>Feed</title><entry><id>urn:uuid:article-123</id><title>Article</title></entry></feed>', "urn:uuid:article-123"],
    ['<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><channel><title>Feed</title></channel><item rdf:about="/articles/123"><title>Article</title></item></rdf:RDF>', "https://example.com/articles/123"],
  ])("preserves native RSS/Atom/RDF article identity", (xml, id) => {
    expect(parseFeed(xml, config.feed_url, 10).articles[0].id).toBe(id);
  });
  it("falls back for oversized native IDs rather than truncating them into collisions", () => {
    const xml = `<rss><channel><title>Feed</title><item><guid>${"a".repeat(2049)}</guid><title>Article</title></item></channel></rss>`;
    expect(parseFeed(xml, config.feed_url, 10).articles[0]).toMatchObject({ title: "Article" });
    expect(parseFeed(xml, config.feed_url, 10).articles[0].id).toBeUndefined();
  });
  it("keeps an Atom identity when an empty extension GUID precedes it", () => {
    const xml = '<feed xmlns:extra="https://example.com/extensions"><title>Feed</title><entry><extra:guid/><id>urn:article:one</id><title>Article</title></entry></feed>';
    expect(parseFeed(xml, config.feed_url, 10).articles[0].id).toBe("urn:article:one");
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
