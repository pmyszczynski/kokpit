// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CalendarConfigSchema, fetchCalendar } from "@/integrations/calendar/api";
import { calendarDocuments, fetchAgenda, parseCalendarDocuments } from "@/integrations/calendar/server";
import { ssrfSafeFetch } from "@/lib/ssrfGuard";
import { splitWidgetConfig } from "@/widgets/configBoundary";
import { widgetCredentialScopesMatch } from "@/widgets/credentialScope";
import "@/integrations/calendar/widget";

vi.mock("@/lib/ssrfGuard", () => ({ ssrfSafeFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const now = new Date("2026-10-20T08:00:00Z"); const until = new Date("2026-10-27T08:00:00Z");
const config = { calendar: "https://cloud.example.com/calendars/me/personal/", timezone: "Europe/Warsaw" };
const event = (fields: string, uid = "one") => `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261001T000000Z\r\n${fields}\r\nEND:VEVENT`;
const calendar = (...events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Kokpit Tests//EN\r\n${events.join("\r\n")}\r\nEND:VCALENDAR\r\n`;
const xml = (ics: string) => `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/one.ics</d:href><d:propstat><d:prop><c:calendar-data><![CDATA[${ics}]]></c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
const timed = "DTSTART:20261020T090000Z\r\nDTEND:20261020T100000Z\r\nSUMMARY:Planning\r\nLOCATION:Studio\r\nDESCRIPTION:Bring notes";
const parse = (ics: string, timezone = config.timezone) => parseCalendarDocuments([ics], now, until, timezone);
const google = { calendar: "calendar@example.com", api_key: "google-test-key", timezone: config.timezone };
const googleEvent = (id: string, start = "2026-10-20T09:00:00Z", end = "2026-10-20T10:00:00Z") => ({ id, summary: "Planning", start: { dateTime: start }, end: { dateTime: end } });
function respond(body: string, options: ResponseInit = {}) { const response = new Response(body, options); vi.mocked(ssrfSafeFetch).mockResolvedValue(response); return response; }

describe("Calendar configuration and credential boundaries", () => {
  it("separates reusable connection secrets from tile options", () => {
    expect(splitWidgetConfig("calendar", { ...config, password: "secret", username: "me", days_ahead: 3, max_items: 8 })).toEqual({ connection: { calendar: config.calendar, username: "me", password: "secret" }, options: { timezone: config.timezone, days_ahead: 3, max_items: 8 } });
    expect(widgetCredentialScopesMatch("calendar", config, { ...config, calendar: "https://other.example.com/" })).toBe(false);
    expect(widgetCredentialScopesMatch("calendar", config, config)).toBe(true);
  });
  it("uses explicit defaults and supports public Google IDs", () => {
    expect(CalendarConfigSchema.parse({ calendar: config.calendar })).toMatchObject({ days_ahead: 7, max_items: 10, timezone: "UTC", username: "", password: "", api_key: "" });
    expect(CalendarConfigSchema.safeParse(google).success).toBe(true);
  });
  it.each([
    { calendar: "https://user:pass@cloud.example.com/" }, { calendar: "https://cloud.example.com/#fragment" }, { calendar: "https://cloud.example.com/#" }, { calendar: "ftp://cloud.example.com/" },
    { calendar: config.calendar, username: "me" }, { calendar: config.calendar, api_key: "wrong-provider" }, { calendar: config.calendar, username: "me:other", password: "secret" },
    { calendar: "calendar@example.com" }, { ...google, username: "me", password: "secret" },
    { ...config, timezone: "Invalid/Zone" }, { ...config, timezone: "+05:00" }, { ...config, timezone: "-03:30" }, { ...config, days_ahead: 0 }, { ...config, max_items: 51 },
  ])("rejects invalid configuration without accepting %j", value => expect(CalendarConfigSchema.safeParse(value).success).toBe(false));
});

describe("CalDAV XML and iCalendar events", () => {
  it("reads namespaced calendar-data and valid empty collections", () => {
    expect(calendarDocuments(xml(calendar(event(timed))))).toEqual([calendar(event(timed)).replaceAll("\r\n", "\n")]);
    expect(calendarDocuments('<multistatus xmlns="DAV:"/>')).toEqual([]);
  });
  it.each([false, true])("rejects response-level CalDAV errors without returning an empty/partial agenda, mixed: %s", mixed => {
    const failure = '<d:response><d:href>/blocked.ics</d:href><d:status>HTTP/1.1 403 Forbidden</d:status></d:response>';
    const response = mixed ? xml(calendar(event(timed))).replace("</d:multistatus>", `${failure}</d:multistatus>`) : `<d:multistatus xmlns:d="DAV:">${failure}</d:multistatus>`;
    expect(() => calendarDocuments(response)).toThrow(expect.objectContaining({ code: "widget_invalid_response", diagnostic: { integration: "calendar", stage: "caldav-status", retryable: false } }));
  });
  it.each(["", "   ", "missing", "HTTP/1.1 200 OK"])("rejects malformed response status/data instead of a false empty agenda: %s", status => {
    const xml = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/incomplete.ics</d:href>${status === "missing" ? "" : `<d:status>${status}</d:status>`}</d:response></d:multistatus>`;
    expect(() => calendarDocuments(xml)).toThrow(expect.objectContaining({ code: "widget_invalid_response" }));
  });
  it.each(["nested-response", "wrapped-response", "duplicate-response-status", "duplicate-property-status", "duplicate-calendar-data", "misplaced-calendar-data"])("rejects malformed CalDAV resource relationships: %s", scenario => {
    const valid = xml(calendar(event(timed)));
    const malformed = scenario === "nested-response" ? valid.replace("<d:response>", "<d:response><d:response>").replace("</d:response>", "</d:response></d:response>")
      : scenario === "wrapped-response" ? valid.replace("<d:response>", "<d:wrapper><d:response>").replace("</d:response>", "</d:response></d:wrapper>")
      : scenario === "duplicate-response-status" ? valid.replace("</d:response>", "<d:status>HTTP/1.1 200 OK</d:status><d:status>HTTP/1.1 403 Forbidden</d:status></d:response>")
      : scenario === "duplicate-property-status" ? valid.replace("</d:propstat>", "<d:status>HTTP/1.1 200 OK</d:status></d:propstat>")
      : scenario === "duplicate-calendar-data" ? valid.replace("</d:prop>", "<c:calendar-data>duplicate</c:calendar-data></d:prop>")
      : valid.replace("<d:prop>", "<d:prop><c:wrapper>").replace("</d:prop>", "</c:wrapper></d:prop>");
    expect(() => calendarDocuments(malformed)).toThrow(expect.objectContaining({ code: "widget_invalid_response" }));
  });
  it.each(['<!DOCTYPE foo [<!ENTITY external SYSTEM "file:///etc/passwd">]><d:multistatus xmlns:d="DAV:"/>', '<multistatus/>', '<d:multistatus xmlns:d="DAV:">&unknown;</d:multistatus>', xml(calendar(event(timed))).replace("200 OK", "403 Forbidden"), `<d:multistatus xmlns:d="DAV:">${"<nested>".repeat(45)}${"</nested>".repeat(45)}</d:multistatus>`])("rejects malformed or failed XML", input => expect(() => calendarDocuments(input)).toThrow(expect.objectContaining({ code: "widget_invalid_response" })));
  it("normalizes timed events, locations, descriptions and safe links", async () => {
    const [result] = await parse(calendar(event(`${timed}\r\nURL:https://example.com/meeting`)));
    expect(result).toMatchObject({ title: "Planning", start: "2026-10-20T09:00:00.000Z", end: "2026-10-20T10:00:00.000Z", location: "Studio", description: "Bring notes", url: "https://example.com/meeting", allDay: false, ongoing: false });
  });
  it("keeps all-day dates and exclusive end dates across extreme time zones", async () => {
    const ics = calendar(event("DTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261023\r\nSUMMARY:Conference"));
    for (const zone of ["Pacific/Kiritimati", "America/Los_Angeles"]) expect((await parse(ics, zone))[0]).toMatchObject({ start: "2026-10-20", end: "2026-10-23", allDay: true });
  });
  it.each(["Asia/Tokyo", "America/Los_Angeles"])("keeps all-day dates when the server runs in %s", async serverTimezone => {
    const input = { documents: [calendar(event("DTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261023\r\nSUMMARY:Conference"))], now: now.toISOString(), until: until.toISOString(), timezone: "Europe/Warsaw" };
    const script = `const {parseCalendars}=require('./src/integrations/calendar/parser.cjs');console.log(JSON.stringify(parseCalendars(${JSON.stringify(input)})));`;
    const { stdout } = await promisify(execFile)(process.execPath, ["-e", script], { env: { ...process.env, TZ: serverTimezone }, encoding: "utf8" });
    const results = JSON.parse(stdout);
    expect(results[0]).toMatchObject({ start: "2026-10-20", end: "2026-10-23" });
  });
  it("uses the tile's zone for floating event times", async () => {
    expect((await parse(calendar(event("DTSTART:20261020T100000\r\nDTEND:20261020T110000\r\nSUMMARY:Floating"))))[0].start).toBe("2026-10-20T08:00:00.000Z");
  });
  it.each(["", "   "])("uses the tile zone when the optional calendar zone is blank: %j", async zone => {
    const ics = calendar(event("DTSTART:20261020T100000\r\nDTEND:20261020T110000\r\nSUMMARY:Floating")).replace("VERSION:2.0", `VERSION:2.0\r\nX-WR-TIMEZONE:${zone}`);
    expect((await parse(ics))[0].start).toBe("2026-10-20T08:00:00.000Z");
  });
  it("uses the fallback zone with explicit DATE-TIME parameters and recurrence exceptions", async () => {
    const base = event("DTSTART;VALUE=DATE-TIME:20261020T100000\r\nDTEND;VALUE=DATE-TIME:20261020T110000\r\nRDATE;VALUE=DATE-TIME:20261021T100000,20261022T100000\r\nEXDATE;VALUE=DATE-TIME:20261021T100000\r\nSUMMARY:Parameterized");
    const moved = event("RECURRENCE-ID;VALUE=DATE-TIME:20261022T100000\r\nDTSTART;VALUE=DATE-TIME:20261022T120000\r\nDTEND;VALUE=DATE-TIME:20261022T130000\r\nSUMMARY:Moved");
    expect((await parse(calendar(base, moved))).map(item => item.start)).toEqual(["2026-10-20T08:00:00.000Z", "2026-10-22T10:00:00.000Z"]);
  });
  it("normalizes case-insensitive iCalendar names and structured values while preserving text and parameterized URLs", async () => {
    const ics = 'begin:vcalendar\r\nversion:2.0\r\nx-wr-timezone:Europe/Warsaw\r\nbegin:vevent\r\nuid:miXeD\r\ndtstart;value=date-time;X-note="keep:semi;colon":20261020t100000\r\ndtend;value=date-time:20261020t110000\r\nrrule:freq=daily;count=2\r\nsummary:MiXeD CASE title\r\nstatus:tentative\r\nurl;X-source=calendar:https://example.com/Meeting#Details\r\nend:vevent\r\nend:vcalendar\r\n';
    const events = await parse(ics, "UTC");
    expect(events.map(event => event.start)).toEqual(["2026-10-20T08:00:00.000Z", "2026-10-21T08:00:00.000Z"]);
    for (const event of events) expect(event).toMatchObject({ title: "MiXeD CASE title", tentative: true, url: "https://example.com/Meeting#Details" });
    expect(events[0].id).toContain("miXeD");
  });
  it("handles lowercase cancelled and parameterized tentative status values", async () => {
    const events = await parse(calendar(event(`${timed}\r\nSTATUS:cancelled`, "cancelled"), event(`${timed}\r\nSTATUS;X-SOURCE=calendar:tentative`, "tentative")));
    expect(events).toHaveLength(1); expect(events[0].tentative).toBe(true);
    const base = event(`${timed}\r\nRRULE:FREQ=DAILY;COUNT=2`);
    const cancelled = event("RECURRENCE-ID:20261021T090000Z\r\nDTSTART:20261021T090000Z\r\nDTEND:20261021T100000Z\r\nSTATUS;X-SOURCE=calendar:cancelled");
    expect((await parse(calendar(base, cancelled))).map(event => event.start)).toEqual(["2026-10-20T09:00:00.000Z"]);
  });
  it("keeps distinct parameterized UIDs separate without changing their identity values", async () => {
    const ics = calendar(event(timed, "one"), event(timed.replace("Planning", "Another event"), "two")).replaceAll("UID:", "UID;VALUE=TEXT;X-SOURCE=calendar:");
    const events = await parse(ics);
    expect(events.map(event => event.title)).toEqual(["Planning", "Another event"]);
    expect(new Set(events.map(event => event.id)).size).toBe(2);
  });
  it("expands daily recurrences through DST with EXDATE and moved overrides", async () => {
    const base = event("DTSTART;TZID=Europe/Warsaw:20261020T090000\r\nDTEND;TZID=Europe/Warsaw:20261020T100000\r\nRRULE:FREQ=DAILY;COUNT=7\r\nEXDATE;TZID=Europe/Warsaw:20261021T090000\r\nSUMMARY:Daily planning");
    const override = event("RECURRENCE-ID;TZID=Europe/Warsaw:20261022T090000\r\nDTSTART;TZID=Europe/Warsaw:20261022T120000\r\nDTEND;TZID=Europe/Warsaw:20261022T130000\r\nSUMMARY:Moved planning");
    const events = await parse(calendar(base, override));
    expect(events.some(item => item.start === "2026-10-21T07:00:00.000Z")).toBe(false);
    expect(events.find(item => item.title === "Moved planning")?.start).toBe("2026-10-22T10:00:00.000Z");
    expect(events.find(item => item.start.startsWith("2026-10-25"))?.start).toBe("2026-10-25T08:00:00.000Z");
  });
  it("omits cancelled events and ended events while retaining ongoing events", async () => {
    const events = await parse(calendar(event(`${timed}\r\nSTATUS:CANCELLED`, "cancelled"), event(timed.replace("090000", "060000").replace("100000", "070000"), "ended"), event(timed.replace("090000", "070000"), "ongoing")));
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ ongoing: true });
  });
  it("expands explicit RDATE values, exclusions, and detached moved instances", async () => {
    const base = event(`${timed}\r\nRDATE:20261022T090000Z,20261023T090000Z\r\nEXDATE:20261023T090000Z`);
    const dates = await parse(calendar(base));
    expect(dates.map(item => item.start)).toEqual(["2026-10-20T09:00:00.000Z", "2026-10-22T09:00:00.000Z"]);
    const moved = event("RECURRENCE-ID:20261022T090000Z\r\nDTSTART:20261022T120000Z\r\nDTEND:20261022T130000Z\r\nSUMMARY:Moved");
    expect((await parse(calendar(event(timed), moved))).map(item => item.start)).toEqual(["2026-10-20T09:00:00.000Z", "2026-10-22T12:00:00.000Z"]);
  });
  it.each([
    ["UTC", "2026-10-20T00:00:00Z", "2026-10-21T00:00:00Z", 1],
    ["America/Los_Angeles", "2026-10-20T07:00:00Z", "2026-10-21T07:00:00Z", 1],
    ["UTC", "2026-10-20T12:00:00Z", "2026-10-21T12:00:00Z", 2],
  ] as const)("uses a half-open all-day recurrence window in %s from %s", async (timezone, start, end, count) => {
    const ics = calendar(event("DTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261021\r\nRRULE:FREQ=DAILY;COUNT=2\r\nSUMMARY:All-day recurring"));
    const events = await parseCalendarDocuments([ics], new Date(start), new Date(end), timezone);
    expect(events).toHaveLength(count);
    expect(events[0].start).toBe("2026-10-20");
  });
  it("keeps the source VTIMEZONE definition when parsing explicit recurrence dates", async () => {
    const timezone = "BEGIN:VTIMEZONE\r\nTZID:Customized Time Zone\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0200\r\nTZNAME:Office\r\nEND:STANDARD\r\nEND:VTIMEZONE";
    const ics = calendar(timezone, event('DTSTART;TZID="Customized Time Zone":20261020T110000\r\nDTEND;TZID="Customized Time Zone":20261020T120000\r\nRDATE;TZID="Customized Time Zone":20261021T110000\r\nSUMMARY:Custom zone'));
    expect((await parse(ics)).map(event => event.start)).toEqual(["2026-10-20T09:00:00.000Z", "2026-10-21T09:00:00.000Z"]);
  });
  it.each([false, true])("accepts a calendar-level custom zone backed by an embedded definition, definition after event: %s", async afterEvent => {
    const timezone = "BEGIN:VTIMEZONE\r\nTZID:Custom/Office\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0200\r\nEND:STANDARD\r\nEND:VTIMEZONE";
    const appointment = event("DTSTART:20261020T110000\r\nDTEND:20261020T120000\r\nRDATE:20261021T110000\r\nSUMMARY:Custom floating");
    const ics = calendar(...(afterEvent ? [appointment, timezone] : [timezone, appointment])).replace("VERSION:2.0", "VERSION:2.0\r\nX-WR-TIMEZONE:Custom/Office");
    expect((await parse(ics)).map(event => event.start)).toEqual(["2026-10-20T09:00:00.000Z", "2026-10-21T09:00:00.000Z"]);
  });
  it("rejects an unresolved embedded zone instead of falling back to the host timezone", async () => {
    const ics = calendar("BEGIN:VTIMEZONE\r\nTZID:Custom/Office\r\nEND:VTIMEZONE", event("DTSTART:20261020T110000\r\nSUMMARY:Unsupported zone")).replace("VERSION:2.0", "VERSION:2.0\r\nX-WR-TIMEZONE:Custom/Office");
    await expect(parse(ics)).rejects.toMatchObject({ code: "widget_invalid_response" });
  });
  it.each(["Customized Time Zone", "Custom/Office"])("rejects an unknown event TZID without an embedded definition: %s", async timezone => {
    const ics = calendar(event(`DTSTART;TZID="${timezone}":20261020T110000\r\nDTEND;TZID="${timezone}":20261020T120000\r\nSUMMARY:Undefined zone`));
    await expect(parse(ics)).rejects.toMatchObject({ code: "widget_invalid_response" });
  });
  it.each(["UTC", "America/Los_Angeles"])("rejects unmappable custom offset pairs when the server runs in %s", async serverTimezone => {
    const timezone = "BEGIN:VTIMEZONE\r\nTZID:Custom/Office\r\nBEGIN:STANDARD\r\nDTSTART:19700101T000000\r\nTZOFFSETFROM:+0349\r\nTZOFFSETTO:+0237\r\nEND:STANDARD\r\nBEGIN:DAYLIGHT\r\nDTSTART:19700601T000000\r\nTZOFFSETFROM:+0237\r\nTZOFFSETTO:+0349\r\nEND:DAYLIGHT\r\nEND:VTIMEZONE";
    const ics = calendar(timezone, event("DTSTART:20261020T110000\r\nDTEND:20261020T120000\r\nSUMMARY:Unmappable zone")).replace("VERSION:2.0", "VERSION:2.0\r\nX-WR-TIMEZONE:Custom/Office");
    const input = { documents: [ics], now: now.toISOString(), until: until.toISOString(), timezone: config.timezone };
    const script = `const {parseCalendars}=require('./src/integrations/calendar/parser.cjs');try{parseCalendars(${JSON.stringify(input)});console.log('accepted')}catch{console.log('rejected')}`;
    const { stdout } = await promisify(execFile)(process.execPath, ["-e", script], { env: { ...process.env, TZ: serverTimezone }, encoding: "utf8" });
    expect(stdout.trim()).toBe("rejected");
    await expect(parse(ics)).rejects.toMatchObject({ code: "widget_invalid_response" });
  });
  it("rejects THISANDFUTURE overrides instead of showing obsolete subsequent times", async () => {
    const base = event(`${timed}\r\nRRULE:FREQ=DAILY;COUNT=3`);
    const override = event("RECURRENCE-ID;RANGE=THISANDFUTURE:20261021T090000Z\r\nDTSTART:20261021T110000Z\r\nDTEND:20261021T120000Z\r\nSUMMARY:Moved future meetings");
    await expect(parse(calendar(base, override))).rejects.toMatchObject({ code: "widget_invalid_response" });
  });
  it("preserves stable UID/start identity, deduplicates resources and rejects unsafe links", async () => {
    const doc = calendar(event(`${timed}\r\nURL:javascript:alert(1)`));
    const first = await parseCalendarDocuments([doc, doc], now, until, config.timezone);
    const second = await parse(calendar(event(timed.replace("Planning", "Renamed"))));
    expect(first).toHaveLength(1); expect(first[0].id).toBe(second[0].id); expect(first[0].url).toBeNull();
  });
  it("rejects malformed calendars and aborts parsing without exposing contents", async () => {
    await expect(parse("not a calendar")).rejects.toMatchObject({ code: "widget_invalid_response" });
    const controller = new AbortController(); controller.abort();
    await expect(parseCalendarDocuments([calendar(event(timed))], now, until, config.timezone, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
  it("rejects a mixed valid/invalid agenda instead of silently dropping obligations", async () => {
    const invalid = event("DTSTART:20261020T100000Z\r\nDTEND:20261020T090000Z\r\nSUMMARY:Invalid duration", "invalid");
    await expect(parse(calendar(event(timed), invalid))).rejects.toMatchObject({ code: "widget_invalid_response" });
  });
  it("interrupts excessive recurrence expansion within its worker budget", async () => {
    const excessive = calendar(event("DTSTART:20261020T090000Z\r\nDTEND:20261020T090001Z\r\nRRULE:FREQ=SECONDLY;COUNT=1000000000\r\nSUMMARY:Excessive"));
    await expect(parse(excessive)).rejects.toMatchObject({ code: "widget_invalid_response" });
    expect((await parse(calendar(event(timed))))[0].title).toBe("Planning");
  });
});

describe("Calendar transport", () => {
  it("makes a read-only CalDAV REPORT with bounded query and no redirects", async () => {
    respond(xml(calendar(event(timed))));
    const data = await fetchAgenda({ ...config, username: "me", password: "app-password", max_items: 1 }, undefined, now);
    expect(data.events).toHaveLength(1);
    expect(ssrfSafeFetch).toHaveBeenCalledWith(config.calendar, expect.objectContaining({ method: "REPORT", allowPrivateNetworks: true, followRedirects: false, body: expect.stringContaining('start="20261020T080000Z"'), headers: expect.objectContaining({ Depth: "1", Authorization: `Basic ${Buffer.from("me:app-password").toString("base64")}` }) }));
  });
  it("paginates Google events, skips cancellations and keeps the API key in a header", async () => {
    vi.mocked(ssrfSafeFetch).mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "cancelled", status: "cancelled" }], nextPageToken: "page-two" }))).mockResolvedValueOnce(new Response(JSON.stringify({ items: [googleEvent("one")] })));
    const data = await fetchAgenda(google, undefined, now);
    expect(data.events).toHaveLength(1); expect(data.events[0]).toMatchObject({ id: "one", title: "Planning" });
    const calls = vi.mocked(ssrfSafeFetch).mock.calls;
    expect(calls[0][0]).toContain("calendar%40example.com/events?"); expect(calls[1][0]).toContain("pageToken=page-two");
    expect(calls[0][0]).not.toContain(google.api_key); expect(calls[0][1]).toMatchObject({ allowPrivateNetworks: false, followRedirects: false, headers: { "X-Goog-Api-Key": google.api_key } });
  });
  it("retains Google all-day dates and skips ended timed events", async () => {
    respond(JSON.stringify({ items: [{ id: "all-day", summary: "Holiday", start: { date: "2026-10-20" }, end: { date: "2026-10-21" } }, googleEvent("ended", "2026-10-20T05:00:00Z", "2026-10-20T06:00:00Z")] }));
    expect((await fetchAgenda(google, undefined, now)).events).toEqual([expect.objectContaining({ allDay: true, start: "2026-10-20", end: "2026-10-21" })]);
  });
  it("also excludes Google all-day events at an exact end boundary", async () => {
    respond(JSON.stringify({ items: [
      { id: "inside", start: { date: "2026-10-20" }, end: { date: "2026-10-21" } },
      { id: "boundary", start: { date: "2026-10-21" }, end: { date: "2026-10-22" } },
    ] }));
    expect((await fetchAgenda({ ...google, timezone: "UTC", days_ahead: 1 }, undefined, new Date("2026-10-20T00:00:00Z"))).events.map(event => event.id)).toEqual(["inside"]);
  });
  it("accepts holiday calendar IDs and preserves safe event URL fragments", async () => {
    respond(JSON.stringify({ items: [{ ...googleEvent("holiday"), htmlLink: "https://example.com/event#details" }] }));
    const data = await fetchAgenda({ ...google, calendar: "en.usa#holiday@group.v.calendar.google.com" }, undefined, now);
    expect(vi.mocked(ssrfSafeFetch).mock.calls[0][0]).toContain("en.usa%23holiday%40group.v.calendar.google.com/events?");
    expect(data.events[0].url).toBe("https://example.com/event#details");
  });
  it.each(["not json", '{"items":[{"id":"one"}]}', JSON.stringify({ items: [googleEvent("bad", "2026-10-20T10:00:00Z", "2026-10-20T09:00:00Z")] })])("rejects invalid Google responses", async body => {
    respond(body); await expect(fetchAgenda(google, undefined, now)).rejects.toMatchObject({ code: "widget_invalid_response" });
  });
  it.each([301, 401, 403, 500])("does not follow HTTP %s or expose upstream content", async status => {
    const response = respond("secret password and internal URL", { status, headers: { Location: "https://other.example.com/" } });
    const error = await fetchAgenda(config, undefined, now).catch(caught => caught);
    expect(error).toMatchObject({ code: "widget_upstream_error", diagnostic: { upstreamStatus: status } });
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toMatch(/secret password|internal URL|other\.example\.com/);
    expect(response.bodyUsed).toBe(true); expect(ssrfSafeFetch).toHaveBeenCalledTimes(1);
  });
  it("rejects oversized responses and preserves aborts", async () => {
    const response = respond("ignored", { headers: { "content-length": String(2 * 1024 * 1024 + 1) } });
    await expect(fetchAgenda(config, undefined, now)).rejects.toMatchObject({ code: "widget_invalid_response" }); expect(response.bodyUsed).toBe(true);
    vi.mocked(ssrfSafeFetch).mockRejectedValue(new DOMException("Aborted", "AbortError"));
    await expect(fetchCalendar(config)).rejects.toMatchObject({ name: "AbortError" });
  });
});
