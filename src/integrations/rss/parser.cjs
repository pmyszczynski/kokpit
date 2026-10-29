/* eslint-disable @typescript-eslint/no-require-imports */
// Run all DOM parsing in a worker so the server can enforce time and heap limits.
const { parentPort, workerData } = require("node:worker_threads");
const { JSDOM } = require("jsdom");
const { SaxesParser } = require("saxes");
const { decodeHTMLStrict } = require("entities");
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_NODES = 10_000;
const MAX_ATTRIBUTES = 20_000;

function articleUrl(value, base) {
  try {
    const url = new URL(value, base);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

const ATOM = "http://www.w3.org/2005/Atom";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RSS = "http://purl.org/rss/1.0/";
const DC = "http://purl.org/dc/elements/1.1/";
const CONTENT = "http://purl.org/rss/1.0/modules/content/";
const XML = "http://www.w3.org/XML/1998/namespace";
function children(parent, name, namespace = parent?.namespaceURI ?? null) {
  const matches = [];
  // Live HTMLCollection iteration in jsdom is quadratic on wide documents.
  for (let element = parent?.firstElementChild; element; element = element.nextElementSibling) {
    if (element.localName === name && element.namespaceURI === namespace) matches.push(element);
  }
  return matches;
}
const child = (parent, name, namespace = parent?.namespaceURI ?? null) => children(parent, name, namespace)[0];
const text = (value) => value?.textContent ?? "";
function invalid(stage) {
  const error = new Error("Widget integration failure");
  error.code = "widget_invalid_response";
  error.diagnostic = { integration: "rss", stage, retryable: false };
  return error;
}
function atomTextMode(value) {
  const type = (value?.getAttribute("type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (type === "html" || type === "text/html") return "escaped-html";
  if (type === "xhtml" || type.endsWith("+xml") || type.endsWith("/xml")) return "html";
  return !type || type === "text" || type.startsWith("text/") ? "text" : "unsupported";
}
function truncate(value, limit) {
  const bounded = value.slice(0, limit);
  return /[\uD800-\uDBFF]$/.test(bounded) ? bounded.slice(0, -1) : bounded;
}
function plain(value, limit, mode = "html") {
  if (!value || mode === "unsupported") return "";
  const serializer = new value.ownerDocument.defaultView.XMLSerializer();
  const source = mode === "html" ? Array.from(value.childNodes, (node) => node.nodeType === 4 ? node.nodeValue ?? "" : serializer.serializeToString(node)).join("") : text(value);
  const bounded = truncate(source, 65_536);
  if (mode === "text") return truncate(bounded.replace(/\s+/g, " ").trim(), limit);
  const fragment = JSDOM.fragment(bounded);
  // Fragments never execute scripts or load resources.
  const blocks = new Set(["p", "div", "li", "section", "article", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "td", "pre"]);
  for (const element of fragment.querySelectorAll("*")) {
    const tag = element.localName.split(":").at(-1);
    if (["script", "style", "template"].includes(tag)) element.remove();
    else if (tag === "br") element.replaceWith(fragment.ownerDocument.createTextNode(" "));
    else if (blocks.has(tag)) element.append(" ");
  }
  return truncate((fragment.textContent ?? "").replace(/\s+/g, " ").trim(), limit);
}
function baseUrl(element, parent) {
  const value = element?.getAttributeNS(XML, "base");
  return value ? articleUrl(value, parent) ?? parent : parent;
}
function link(parent, base) {
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
function namedEntities(xml) {
  return xml.replace(/&([A-Za-z][A-Za-z0-9]*);/g, (reference, name) => {
    if (["amp", "lt", "gt", "quot", "apos"].includes(name)) return reference;
    const decoded = decodeHTMLStrict(reference);
    return decoded === reference ? reference : Array.from(decoded, (char) => `&#${char.codePointAt(0)};`).join("");
  });
}
function prepareXml(xml) {
  const parts = [];
  let cursor = 0;
  for (let index = xml.indexOf("<"); index !== -1; index = xml.indexOf("<", index + 1)) {
    const terminator = xml.startsWith("<!--", index) ? "-->" : xml.startsWith("<![CDATA[", index) ? "]]>" : xml.startsWith("<?", index) ? "?>" : null;
    if (terminator) {
      const end = xml.indexOf(terminator, index + (terminator === "-->" ? 4 : terminator === "]]>" ? 9 : 2));
      if (end === -1) throw invalid("xml");
      parts.push(namedEntities(xml.slice(cursor, index)), xml.slice(index, end + terminator.length));
      cursor = end + terminator.length;
      index = cursor - 1;
    } else if (/^<!\s*(DOCTYPE|ENTITY)\b/i.test(xml.slice(index))) throw invalid("xml");
  }
  parts.push(namedEntities(xml.slice(cursor)));
  return parts.join("");
}
function rdfResource(value, base) {
  if (!value?.trim()) return null;
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}
function rdfItems(root, channel, rootBase, channelBase) {
  const items = children(root, "item", channel.namespaceURI);
  const container = child(channel, "items");
  const sequence = child(container, "Seq", RDF);
  if (!sequence) return items;
  const sequenceBase = baseUrl(sequence, baseUrl(container, channelBase));
  const indexed = new Map();
  for (const item of items) {
    const resource = rdfResource(item.getAttributeNS(RDF, "about"), baseUrl(item, rootBase));
    if (resource && !indexed.has(resource)) indexed.set(resource, item);
  }
  const ordered = [];
  const seen = new Set();
  for (const entry of children(sequence, "li", RDF)) {
    const resource = rdfResource(entry.getAttributeNS(RDF, "resource"), baseUrl(entry, sequenceBase));
    if (resource && indexed.has(resource) && !seen.has(resource)) {
      ordered.push(indexed.get(resource));
      seen.add(resource);
    }
  }
  return ordered;
}
// Count the complete document before allocating a DOM, including ignored extensions.
function validateXml(xml) {
  let depth = 0; let nodes = 0; let attributes = 0;
  const parser = new SaxesParser({ xmlns: true });
  const node = () => { if (++nodes > MAX_NODES) throw invalid("xml"); };
  parser.on("opentag", tag => {
    node();
    const count = Object.keys(tag.attributes).length;
    attributes += count;
    if (++depth > 40 || count > 100 || attributes > MAX_ATTRIBUTES) throw invalid("xml");
  });
  parser.on("closetag", () => { depth--; });
  parser.on("text", node); parser.on("cdata", node);
  parser.on("comment", node); parser.on("processinginstruction", node);
  parser.on("doctype", () => { throw invalid("xml"); });
  try { parser.write(xml).close(); } catch { throw invalid("xml"); }
}
function parseFeed(xml, feedUrl, maxItems) {
  if (typeof xml !== "string" || Buffer.byteLength(xml, "utf8") > MAX_BYTES) throw invalid("size");
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 50) throw invalid("feed");
  const prepared = prepareXml(xml);
  validateXml(prepared);
  let dom;
  try {
    dom = new JSDOM(prepared, { contentType: "text/xml" });
  } catch {
    throw invalid("xml");
  }
  try {
    const root = dom.window.document.documentElement;
    const isAtom = root.localName === "feed" && (root.namespaceURI === ATOM || root.namespaceURI === null);
    const isRdf = root.localName === "RDF" && root.namespaceURI === RDF;
    const isRss = root.localName === "rss" && root.namespaceURI === null;
    let channel = isAtom ? root : isRss ? child(root, "channel") : undefined;
    if (isRdf) for (let element = root.firstElementChild; element; element = element.nextElementSibling) {
      if (element.localName === "channel" && [null, RSS].includes(element.namespaceURI)) { channel = element; break; }
    }
    if (!channel) throw invalid("feed");
    const rootBase = baseUrl(root, feedUrl);
    const base = isAtom ? rootBase : baseUrl(channel, rootBase);
    const items = isAtom ? children(root, "entry") : isRdf ? rdfItems(root, channel, rootBase, base) : children(channel, "item");
    const title = child(channel, "title");
    return { title: plain(title, 200, isAtom ? atomTextMode(title) : "html") || "Feed", articles: items.slice(0, maxItems).map((item) => {
      const itemBase = baseUrl(item, isRdf ? rootBase : base);
      const guid = child(item, "guid");
      const id = isRdf ? rdfResource(item.getAttributeNS(RDF, "about"), itemBase) : [guid, child(item, "id")].map((value) => text(value).trim()).find((value) => value.length > 0 && value.length <= 2048);
      const dates = [child(item, "pubDate"), child(item, "published"), child(item, "updated"), child(item, "date", DC), child(item, "date")];
      const timestamp = dates.map((value) => Date.parse(text(value))).find(Number.isFinite);
      let summary = "";
      for (const value of [child(item, "description"), child(item, "summary"), child(item, "encoded", CONTENT), child(item, "encoded"), child(item, "content")]) {
        summary = plain(value, 500, isAtom ? atomTextMode(value) : "escaped-html");
        if (summary) break;
      }
      const permalinkFlag = guid?.getAttribute("isPermaLink");
      const permalink = isRss && text(guid).trim() && (permalinkFlag == null || permalinkFlag === "true") ? articleUrl(text(guid).trim()) : null;
      const itemTitle = child(item, "title");
      return {
        ...(id && id.length <= 2048 ? { id } : {}),
        title: plain(itemTitle, 500, isAtom ? atomTextMode(itemTitle) : "html") || "Untitled article",
        url: link(item, itemBase) ?? permalink,
        publishedAt: timestamp === undefined ? null : new Date(timestamp).toISOString(),
        summary
      };
    }) };
  } finally {
    dom.window.close();
  }
}

module.exports = { parseFeed };
if (parentPort) {
  try { parentPort.postMessage({ data: parseFeed(workerData.xml, workerData.feedUrl, workerData.maxItems) }); }
  catch (error) { parentPort.postMessage({ error: true, stage: error.diagnostic?.stage }); }
}
