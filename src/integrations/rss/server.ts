import { JSDOM } from "jsdom";
import { ssrfSafeFetch } from "@/lib/ssrfGuard";
import { WidgetFetchError } from "@/widgets/publicFetchError";
import { articleUrl, RssConfigSchema, type RssConfig, type RssData } from "./api";

const MAX_BYTES = 2 * 1024 * 1024;
const ATOM = "http://www.w3.org/2005/Atom";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RSS = "http://purl.org/rss/1.0/";
const DC = "http://purl.org/dc/elements/1.1/";
const CONTENT = "http://purl.org/rss/1.0/modules/content/";
const XML = "http://www.w3.org/XML/1998/namespace";

function children(parent: Element | undefined, name: string, namespace = parent?.namespaceURI ?? null): Element[] {
  return parent ? Array.from(parent.children).filter(child => child.localName === name && child.namespaceURI === namespace) : [];
}
const child = (parent: Element | undefined, name: string, namespace = parent?.namespaceURI ?? null): Element | undefined => children(parent, name, namespace)[0];
const text = (value: Element | undefined): string => value?.textContent ?? "";
function invalid(stage: string): WidgetFetchError {
  return new WidgetFetchError("widget_invalid_response", { integration: "rss", stage, retryable: false });
}

type TextMode = "text" | "html" | "escaped-html";
function atomTextMode(value: Element | undefined): TextMode {
  const type = (value?.getAttribute("type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (type === "html" || type === "text/html") return "escaped-html";
  if (type === "xhtml" || type.endsWith("+xml") || type.endsWith("/xml")) return "html";
  return "text";
}
function truncate(value: string, limit: number): string {
  const bounded = value.slice(0, limit);
  return /[\uD800-\uDBFF]$/.test(bounded) ? bounded.slice(0, -1) : bounded;
}

/** XML text is already decoded; serialized XHTML preserves markup and literal escaped tags. */
function plain(value: Element | undefined, limit: number, mode: TextMode = "html"): string {
  if (!value) return "";
  const serializer = new value.ownerDocument.defaultView!.XMLSerializer();
  const source = mode === "html" ? Array.from(value.childNodes, node => node.nodeType === 4 ? node.nodeValue ?? "" : serializer.serializeToString(node)).join("") : text(value);
  const bounded = truncate(source, 65_536);
  if (mode === "text") return truncate(bounded.replace(/\s+/g, " ").trim(), limit);
  // Fragments have no browsing context: scripts and resources never execute/load.
  const fragment = JSDOM.fragment(bounded);
  const blocks = new Set(["p", "div", "li", "section", "article", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "td", "pre"]);
  for (const element of fragment.querySelectorAll("*")) {
    const tag = element.localName.split(":").at(-1)!;
    if (["script", "style", "template"].includes(tag)) element.remove();
    else if (tag === "br") element.replaceWith(fragment.ownerDocument.createTextNode(" "));
    else if (blocks.has(tag)) element.append(" ");
  }
  return truncate((fragment.textContent ?? "").replace(/\s+/g, " ").trim(), limit);
}
function baseUrl(element: Element | undefined, parent: string): string {
  const value = element?.getAttributeNS(XML, "base");
  return value ? articleUrl(value, parent) ?? parent : parent;
}
function link(parent: Element, base: string): string | null {
  for (const element of children(parent, "link")) {
    const relation = element.getAttribute("rel");
    if (relation && relation !== "alternate") continue;
    const raw = element.getAttribute("href") || text(element);
    if (!raw.trim()) continue;
    const url = articleUrl(raw, baseUrl(element, base));
    if (url) return url;
  }
  return null;
}
function hasDtd(xml: string): boolean {
  for (let index = xml.indexOf("<"); index !== -1; index = xml.indexOf("<", index + 1)) {
    const terminator = xml.startsWith("<!--", index) ? "-->" : xml.startsWith("<![CDATA[", index) ? "]]>" : xml.startsWith("<?", index) ? "?>" : null;
    if (terminator) {
      const end = xml.indexOf(terminator, index + (terminator === "-->" ? 4 : terminator === "]]>" ? 9 : 2));
      if (end === -1) return false; // The XML parser rejects the unclosed section.
      index = end + terminator.length - 1;
    } else if (/^<!\s*(DOCTYPE|ENTITY)\b/i.test(xml.slice(index))) return true;
  }
  return false;
}
function rdfResource(value: string | null, base: string): string | null {
  if (!value?.trim()) return null;
  try { return new URL(value, base).href; } catch { return null; }
}
function rdfItems(root: Element, channel: Element, rootBase: string, channelBase: string): Element[] {
  const items = children(root, "item", channel.namespaceURI);
  const container = child(channel, "items"); const sequence = child(container, "Seq", RDF);
  if (!sequence) return items;
  const sequenceBase = baseUrl(sequence, baseUrl(container, channelBase));
  const indexed = new Map<string, Element>();
  for (const item of items) {
    const resource = rdfResource(item.getAttributeNS(RDF, "about"), baseUrl(item, rootBase));
    if (resource && !indexed.has(resource)) indexed.set(resource, item);
  }
  const ordered: Element[] = []; const seen = new Set<string>();
  for (const entry of children(sequence, "li", RDF)) {
    const resource = rdfResource(entry.getAttributeNS(RDF, "resource"), baseUrl(entry, sequenceBase));
    if (resource && indexed.has(resource) && !seen.has(resource)) {
      ordered.push(indexed.get(resource)!); seen.add(resource);
    }
  }
  return ordered;
}
function checkDepth(root: Element): void {
  const walker = root.ownerDocument.createTreeWalker(root, 1);
  for (let element: Element | null = root; element; element = walker.nextNode() as Element | null) {
    let depth = 0;
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      if (++depth > 40) throw invalid("xml");
    }
  }
}

export function parseFeed(xml: string, feedUrl: string, maxItems: number): RssData {
  if (hasDtd(xml)) throw invalid("xml");
  let dom: JSDOM;
  try { dom = new JSDOM(xml, { contentType: "text/xml" }); } catch { throw invalid("xml"); }
  try {
    const root = dom.window.document.documentElement;
    checkDepth(root);
    const isAtom = root.localName === "feed" && (root.namespaceURI === ATOM || root.namespaceURI === null);
    const isRdf = root.localName === "RDF" && root.namespaceURI === RDF;
    const isRss = root.localName === "rss" && root.namespaceURI === null;
    const channel = isAtom ? root : isRdf ? Array.from(root.children).find(element => element.localName === "channel" && [null, RSS].includes(element.namespaceURI)) : isRss ? child(root, "channel") : undefined;
    if (!channel) throw invalid("feed");
    const rootBase = baseUrl(root, feedUrl); const base = isAtom ? rootBase : baseUrl(channel, rootBase);
    const items = isAtom ? children(root, "entry") : isRdf ? rdfItems(root, channel, rootBase, base) : children(channel, "item");
    const title = child(channel, "title");
    return { title: plain(title, 200, isAtom ? atomTextMode(title) : "html") || "Feed", articles: items.slice(0, maxItems).map(item => {
      const itemBase = baseUrl(item, isRdf ? rootBase : base);
      const guid = child(item, "guid");
      const id = isRdf ? rdfResource(item.getAttributeNS(RDF, "about"), itemBase) : [guid, child(item, "id")].map(value => text(value).trim()).find(value => value.length > 0 && value.length <= 2048);
      const dates = [child(item, "pubDate"), child(item, "published"), child(item, "updated"), child(item, "date", DC), child(item, "date")];
      const timestamp = dates.map(value => Date.parse(text(value))).find(Number.isFinite);
      let summary = "";
      for (const value of [child(item, "description"), child(item, "summary"), child(item, "encoded", CONTENT), child(item, "encoded"), child(item, "content")]) {
        summary = plain(value, 500, isAtom ? atomTextMode(value) : "escaped-html");
        if (summary) break;
      }
      const permalinkFlag = guid?.getAttribute("isPermaLink");
      const permalink = isRss && text(guid).trim() && (permalinkFlag == null || permalinkFlag === "true") ? articleUrl(text(guid).trim()) : null;
      const title = child(item, "title");
      return { ...(id && id.length <= 2048 ? { id } : {}), title: plain(title, 500, isAtom ? atomTextMode(title) : "html") || "Untitled article",
        url: link(item, itemBase) ?? permalink, publishedAt: timestamp === undefined ? null : new Date(timestamp).toISOString(), summary };
    }) };
  } finally { dom.window.close(); }
}

async function boundedText(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel().catch(() => {}); throw invalid("size");
  }
  if (!response.body) throw invalid("xml");
  const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0; let xml = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw invalid("size");
      xml += decoder.decode(value, { stream: true });
    }
    return xml + decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => {}); throw error;
  } finally { reader.releaseLock(); }
}

export async function fetchFeed(input: RssConfig, signal?: AbortSignal): Promise<RssData> {
  const config = RssConfigSchema.parse(input);
  let response: Response;
  try {
    response = await ssrfSafeFetch(config.feed_url, { signal, allowPrivateNetworks: false,
      headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9" } });
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    throw new WidgetFetchError("widget_upstream_unreachable", { integration: "rss", stage: "fetch", retryable: true });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new WidgetFetchError("widget_upstream_error", { integration: "rss", stage: "http", upstreamStatus: response.status, retryable: response.status === 429 || response.status >= 500 });
  }
  try { return parseFeed(await boundedText(response), response.url || config.feed_url, config.max_items); }
  catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError") || error instanceof WidgetFetchError) throw error;
    throw invalid("body");
  }
}
