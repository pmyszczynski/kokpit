import { Worker } from "node:worker_threads";
import path from "node:path";
import { SaxesParser } from "saxes";
import { z } from "zod";
import { JSDOM } from "jsdom";
import { ssrfSafeFetch, type SsrfSafeFetchOptions } from "@/lib/ssrfGuard";
import { WidgetFetchError } from "@/widgets/publicFetchError";
import { calendarUrl, eventUrl, CalendarConfigSchema, type CalendarConfig, type CalendarData, type AgendaEvent } from "./api";

const MAX_BYTES = 2 * 1024 * 1024;
const DAV = "DAV:"; const CALDAV = "urn:ietf:params:xml:ns:caldav";
function invalid(stage: string) { return new WidgetFetchError("widget_invalid_response", { integration: "calendar", stage, retryable: false }); }
async function request(url: string, options: SsrfSafeFetchOptions): Promise<string> {
  let response: Response;
  try { response = await ssrfSafeFetch(url, { ...options, followRedirects: false }); }
  catch (error) {
    if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    throw new WidgetFetchError("widget_upstream_unreachable", { integration: "calendar", stage: "fetch", retryable: true });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new WidgetFetchError("widget_upstream_error", { integration: "calendar", stage: "http", upstreamStatus: response.status, retryable: response.status === 429 || response.status >= 500 });
  }
  if (!response.body || Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel().catch(() => {}); throw invalid("size");
  }
  const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0; let text = "";
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength; if (size > MAX_BYTES) throw invalid("size");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError") || error instanceof WidgetFetchError) throw error;
    throw invalid("body");
  } finally { reader.releaseLock(); }
}

/** Namespace-aware, bounded XML tokenization without a DOM or entity expansion. */
export function calendarDocuments(xml: string): string[] {
  const documents: string[] = []; const stack: { local: string; uri: string }[] = [];
  let root = false; let status = ""; let calendar = ""; let propstat = false; let propStatusPresent = false; let calendarDataPresent = false; let responseStatus = ""; let responseStatusPresent = false; let responseStart = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on("doctype", () => { throw invalid("xml"); });
  parser.on("opentag", tag => {
    stack.push(tag); if (stack.length > 40) throw invalid("xml");
    if (stack.length === 1) { root = tag.uri === DAV && tag.local === "multistatus"; if (!root) throw invalid("xml"); }
    const parent = stack.at(-2);
    if (tag.uri === DAV && tag.local === "response") {
      if (stack.length !== 2 || parent?.uri !== DAV || parent.local !== "multistatus") throw invalid("xml");
      responseStatus = ""; responseStatusPresent = false; responseStart = documents.length;
    }
    if (tag.uri === DAV && tag.local === "status") {
      if (parent?.uri !== DAV || !["response", "propstat"].includes(parent.local)) throw invalid("xml");
      if (parent.local === "response") { if (responseStatusPresent) throw invalid("xml"); responseStatusPresent = true; }
      else { if (propStatusPresent) throw invalid("xml"); propStatusPresent = true; }
    }
    if (tag.uri === DAV && tag.local === "propstat") {
      if (propstat || parent?.uri !== DAV || parent.local !== "response") throw invalid("xml");
      propstat = true; propStatusPresent = false; calendarDataPresent = false; status = ""; calendar = "";
    }
    if (tag.uri === DAV && tag.local === "prop" && (parent?.uri !== DAV || parent.local !== "propstat")) throw invalid("xml");
    if (tag.uri === CALDAV && tag.local === "calendar-data") {
      if (stack.length !== 5 || parent?.uri !== DAV || parent.local !== "prop" || calendarDataPresent) throw invalid("xml");
      calendarDataPresent = true;
    }
  });
  const text = (value: string) => {
    const tag = stack.at(-1);
    const parent = stack.at(-2);
    if (propstat && tag?.uri === DAV && tag.local === "status") status += value;
    if (tag?.uri === DAV && tag.local === "status" && parent?.uri === DAV && parent.local === "response") responseStatus += value;
    if (propstat && tag?.uri === CALDAV && tag.local === "calendar-data") calendar += value;
  };
  parser.on("text", text); parser.on("cdata", text);
  parser.on("closetag", tag => {
    if (tag.uri === DAV && tag.local === "response") {
      if (responseStatusPresent && !/^HTTP\/\S+\s+2\d\d(?:\s|$)/.test(responseStatus.trim())) throw invalid("caldav-status");
      if (documents.length === responseStart) throw invalid("caldav-data");
    }
    if (tag.uri === DAV && tag.local === "propstat") {
      if (!/^HTTP\/\S+ 200(?:\s|$)/.test(status.trim())) throw invalid("caldav-status");
      if (calendar.trim()) documents.push(calendar); propstat = false;
    }
    stack.pop();
  });
  try { parser.write(xml).close(); } catch (error) { if (error instanceof WidgetFetchError) throw error; throw invalid("xml"); }
  if (!root) throw invalid("xml");
  return documents;
}

let activeParsers = 0;
export function parseCalendarDocuments(documents: string[], now: Date, until: Date, timezone: string, signal?: AbortSignal): Promise<AgendaEvent[]> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  if (activeParsers >= 4) return Promise.reject(new WidgetFetchError("widget_upstream_unreachable", { integration: "calendar", stage: "busy", retryable: true }));
  return new Promise((resolve, reject) => {
    // Turbopack rejects an imported path constant here. Keep this literal aligned
    // with next.config.ts tracing; the isolated production test exercises both.
    const worker = new Worker(path.join(process.cwd(), "src/integrations/calendar/parser.cjs"), {
      workerData: { documents, now: now.toISOString(), until: until.toISOString(), timezone },
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16 },
      stdout: true, stderr: true,
    });
    worker.stdout?.resume(); worker.stderr?.resume();
    activeParsers++;
    let settled = false;
    const finish = (error?: unknown, events?: AgendaEvent[]) => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      void worker.terminate().then(() => {
        activeParsers--;
        if (error) reject(error); else resolve(events!);
      }, () => { activeParsers--; reject(error ?? invalid("ical")); });
    };
    const abort = () => finish(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => finish(invalid("parse-budget")), 2000);
    worker.once("message", (message: { events?: AgendaEvent[]; error?: boolean }) => finish(message.error || !message.events ? invalid("ical") : undefined, message.events));
    worker.once("error", () => finish(invalid("ical")));
    worker.once("exit", () => { if (!settled) finish(invalid("ical")); });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

const GoogleTime = z.object({ date: z.iso.date().optional(), dateTime: z.iso.datetime({ offset: true }).optional() }).refine(value => Boolean(value.date) !== Boolean(value.dateTime));
const GooglePage = z.object({
  nextPageToken: z.string().max(2048).optional(),
  items: z.array(z.object({ id: z.string().min(1).max(2048), status: z.enum(["confirmed", "tentative", "cancelled"]).optional(),
    summary: z.string().max(100_000).optional(), location: z.string().max(100_000).optional(), description: z.string().max(100_000).optional(),
    htmlLink: z.string().optional(), start: GoogleTime.optional(), end: GoogleTime.optional(),
  })).max(2500).default([]),
});
function day(date: Date, timezone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
function plain(value: string | undefined, limit: number, html = false) {
  let text = (value ?? "").slice(0, 65_536);
  if (html) {
    const fragment = JSDOM.fragment(text);
    for (const element of fragment.querySelectorAll("script, style, template")) element.remove();
    for (const element of fragment.querySelectorAll("br, p, div, li")) element.append(" ");
    text = fragment.textContent ?? "";
  }
  return text.replace(/\s+/g, " ").trim().slice(0, limit).replace(/[\uD800-\uDBFF]$/, "");
}
async function googleEvents(config: z.output<typeof CalendarConfigSchema>, now: Date, until: Date, signal?: AbortSignal): Promise<AgendaEvent[]> {
  const events: AgendaEvent[] = []; const seen = new Set<string>(); let token = "";
  const firstDay = day(now, config.timezone); const finalDay = day(until, config.timezone);
  const finalDayIncluded = until.getUTCMilliseconds() !== 0 || new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(until) !== "00:00:00";
  for (let page = 0; page < 10; page++) {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendar)}/events`);
    for (const [key, value] of Object.entries({ singleEvents: "true", orderBy: "startTime", timeMin: now.toISOString(), timeMax: until.toISOString(), timeZone: config.timezone, maxResults: String(config.max_items), showDeleted: "false", ...(token ? { pageToken: token } : {}) })) url.searchParams.set(key, value);
    const body = await request(url.href, { signal, allowPrivateNetworks: false, headers: { Accept: "application/json", "X-Goog-Api-Key": config.api_key } });
    let parsed: z.output<typeof GooglePage>;
    try { parsed = GooglePage.parse(JSON.parse(body)); } catch { throw invalid("google"); }
    for (const event of parsed.items) {
      if (event.status === "cancelled" || seen.has(event.id)) continue;
      seen.add(event.id);
      const allDay = Boolean(event.start?.date); const start = event.start?.date ?? event.start?.dateTime; const end = event.end?.date ?? event.end?.dateTime;
      if (!start || !end || allDay !== Boolean(event.end?.date) || (allDay ? end <= start : Date.parse(end) < Date.parse(start))) throw invalid("google-date");
      if (allDay ? end <= firstDay || start > finalDay || (start === finalDay && !finalDayIncluded) : Date.parse(start) >= until.getTime() || (Date.parse(end) <= now.getTime() && Date.parse(start) < now.getTime())) continue;
      events.push({ id: event.id, title: plain(event.summary, 300) || "Untitled event", start: allDay ? start : new Date(start).toISOString(), end: allDay ? end : new Date(end).toISOString(), allDay,
        url: event.htmlLink ? eventUrl(event.htmlLink) : null, location: plain(event.location, 200), description: plain(event.description, 500, true), tentative: event.status === "tentative", ongoing: !allDay && Date.parse(start) < now.getTime() && Date.parse(end) > now.getTime() });
      if (events.length >= config.max_items) return events;
    }
    if (!parsed.nextPageToken) return events;
    if (parsed.nextPageToken === token) throw invalid("pagination");
    token = parsed.nextPageToken;
  }
  throw invalid("pagination");
}

export async function fetchAgenda(input: CalendarConfig, signal?: AbortSignal, now = new Date()): Promise<CalendarData> {
  const config = CalendarConfigSchema.parse(input); const until = new Date(now.getTime() + config.days_ahead * 86_400_000);
  let events: AgendaEvent[];
  if (calendarUrl(config.calendar)) {
    const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const body = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${stamp(now)}" end="${stamp(until)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
    const xml = await request(config.calendar, { method: "REPORT", body, signal, allowPrivateNetworks: true,
      headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8", Accept: "application/xml, text/xml", ...(config.username ? { Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}` } : {}) } });
    events = await parseCalendarDocuments(calendarDocuments(xml), now, until, config.timezone, signal);
  } else events = await googleEvents(config, now, until, signal);
  const dateKey = (event: AgendaEvent) => event.allDay ? event.start : day(new Date(event.start), config.timezone);
  events.sort((a, b) => dateKey(a).localeCompare(dateKey(b)) || (a.allDay !== b.allDay ? a.allDay ? -1 : 1 : a.allDay ? 0 : Date.parse(a.start) - Date.parse(b.start)) || a.id.localeCompare(b.id));
  return { events: events.slice(0, config.max_items), timezone: config.timezone, daysAhead: config.days_ahead };
}
