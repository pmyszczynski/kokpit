import { XMLParser, XMLValidator } from "fast-xml-parser";
import { decodeXML } from "entities";
import { JSDOM } from "jsdom";
import { ssrfSafeFetch } from "@/lib/ssrfGuard";
import { WidgetFetchError } from "@/widgets/publicFetchError";
import { articleUrl, RssConfigSchema, type RssConfig, type RssData } from "./api";

const MAX_BYTES = 2 * 1024 * 1024;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true,
  parseTagValue: false, parseAttributeValue: false, htmlEntities: true, maxNestedTags: 40,
  stopNodes: ["*.title", "*.description", "*.summary", "*.content", "*.encoded"],
  isArray: tag => ["item", "entry", "link"].includes(tag) });
type Node = Record<string, unknown>;
const node = (value: unknown): Node => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Node : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];
const text = (value: unknown): string => typeof value === "string" ? value : typeof node(value)["#text"] === "string" ? node(value)["#text"] as string : "";

// Inert HTML parsing preserves literal comparison signs and never runs scripts or loads resources.
type TextMode = "text" | "html" | "escaped-html";
function atomTextMode(value: unknown): TextMode {
  const type = text(node(value)["@type"]).split(";", 1)[0].trim().toLowerCase();
  if (type === "html" || type === "text/html") return "escaped-html";
  if (type === "xhtml" || type.endsWith("+xml") || type === "application/xml" || type === "text/xml") return "html";
  return "text";
}
function truncate(value: string, limit: number): string {
  const bounded = value.slice(0, limit);
  return /[\uD800-\uDBFF]$/.test(bounded) ? bounded.slice(0, -1) : bounded;
}
function plain(value: unknown, limit: number, mode: TextMode = "html"): string {
  const source = text(value);
  if (!source.trim()) return "";
  const markup = source.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/g).map(part =>
    part.startsWith("<![CDATA[") ? part.slice(9, -3) : mode === "html" ? part : decodeXML(part)).join("");
  // Bound text/HTML formatting separately from the feed's overall byte budget.
  const bounded = truncate(markup, 65_536);
  if (mode === "text") return truncate(bounded.replace(/\s+/g, " ").trim(), limit);
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
function invalid(stage: string): WidgetFetchError {
  return new WidgetFetchError("widget_invalid_response", { integration: "rss", stage, retryable: false });
}
function baseUrl(value: unknown, parent: string): string {
  return articleUrl(text(value), parent) ?? parent;
}
function link(value: unknown, base: string): string | null {
  for (const candidate of array(value)) {
    const item = node(candidate);
    if (item["@rel"] && item["@rel"] !== "alternate") continue;
    const raw = text(item["@href"]) || text(candidate);
    if (!raw.trim()) continue;
    const url = articleUrl(raw, baseUrl(item["@base"], base));
    if (url) return url;
  }
  return null;
}

function hasDtd(xml: string): boolean {
  for (let index = xml.indexOf("<"); index !== -1; index = xml.indexOf("<", index + 1)) {
    const terminator = xml.startsWith("<!--", index) ? "-->" : xml.startsWith("<![CDATA[", index) ? "]]>" : xml.startsWith("<?", index) ? "?>" : null;
    if (terminator) {
      const end = xml.indexOf(terminator, index + (terminator === "-->" ? 4 : terminator === "]]>" ? 9 : 2));
      if (end === -1) return false; // XML validation rejects the unclosed section.
      index = end + terminator.length - 1;
    } else if (/^<!\s*(DOCTYPE|ENTITY)\b/i.test(xml.slice(index))) return true;
  }
  return false;
}

function rdfResource(value: unknown, base: string): string | null {
  const resource = text(value).trim();
  if (!resource) return null;
  try { return new URL(resource, base).href; } catch { return null; }
}

function rdfItems(rdf: Node, channel: Node, rootBase: string, channelBase: string): unknown[] {
  const items = array(rdf.item);
  const container = node(channel.items); const sequence = node(container.Seq);
  if (!Object.keys(sequence).length) return items;
  const sequenceBase = baseUrl(sequence["@base"], baseUrl(container["@base"], channelBase));
  const indexed = new Map<string, unknown>();
  for (const value of items) {
    const item = node(value); const resource = rdfResource(item["@about"], baseUrl(item["@base"], rootBase));
    if (resource && !indexed.has(resource)) indexed.set(resource, value);
  }
  const ordered: unknown[] = []; const seen = new Set<string>();
  for (const value of array(sequence.li)) {
    const entry = node(value); const resource = rdfResource(entry["@resource"], baseUrl(entry["@base"], sequenceBase));
    if (resource && indexed.has(resource) && !seen.has(resource)) {
      ordered.push(indexed.get(resource)); seen.add(resource);
    }
  }
  return ordered;
}

export function parseFeed(xml: string, feedUrl: string, maxItems: number): RssData {
  // DTDs are unnecessary for RSS/Atom: reject declarations before validation or expansion.
  if (hasDtd(xml) || XMLValidator.validate(xml) !== true) throw invalid("xml");
  let root: Node;
  try { root = node(parser.parse(xml)); } catch { throw invalid("xml"); }
  const rss = node(root.rss); const atom = node(root.feed); const rdf = node(root.RDF);
  const isAtom = Object.keys(atom).length > 0;
  const channel = Object.keys(rss).length ? node(rss.channel) : isAtom ? atom : node(rdf.channel);
  if (!Object.keys(channel).length) throw invalid("feed");
  const rootBase = baseUrl(rss["@base"] ?? atom["@base"] ?? rdf["@base"], feedUrl);
  const base = isAtom ? rootBase : baseUrl(channel["@base"], rootBase);
  const isRdf = Object.keys(rdf).length > 0;
  const items = isAtom ? atom.entry : isRdf ? rdfItems(rdf, channel, rootBase, base) : channel.item;
  return { title: plain(channel.title, 200, isAtom ? atomTextMode(channel.title) : "html") || "Feed", articles: array(items).slice(0, maxItems).map(value => {
    const item = node(value); const itemBase = baseUrl(item["@base"], isRdf ? rootBase : base);
    const id = isRdf ? rdfResource(item["@about"], itemBase) : [item.guid, item.id].map(value => text(value).trim()).find(value => value.length > 0 && value.length <= 2048);
    const timestamp = [item.pubDate, item.published, item.updated, item.date].map(value => Date.parse(text(value))).find(Number.isFinite);
    let summary = "";
    for (const value of [item.description, item.summary, item.encoded, item.content]) {
      summary = plain(value, 500, isAtom ? atomTextMode(value) : "escaped-html");
      if (summary) break;
    }
    const guid = text(item.guid).trim(); const permalinkFlag = node(item.guid)["@isPermaLink"];
    const permalink = Object.keys(rss).length && guid && (permalinkFlag === undefined || permalinkFlag === "true") ? articleUrl(guid) : null;
    return { ...(id && id.length <= 2048 ? { id } : {}), title: plain(item.title, 500, isAtom ? atomTextMode(item.title) : "html") || "Untitled article", url: link(item.link, itemBase) ?? permalink,
      publishedAt: timestamp === undefined ? null : new Date(timestamp).toISOString(), summary };
  }) };
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
