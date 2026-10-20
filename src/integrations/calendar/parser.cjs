/* eslint-disable @typescript-eslint/no-require-imports */
// A separate worker lets the server interrupt synchronous recurrence expansion.
const { parentPort, workerData } = require("node:worker_threads");
const ical = require("node-ical");
const path = require("node:path");
const runtimeRequire = require("node:module").createRequire(path.join(process.cwd(), "package.json"));
// Use the dependency's own resolver before parseICS can substitute the host zone.
// Its packaged ESM helper is synchronous under the project's Node >=22.19 floor;
// standalone tracing includes the complete node-ical package and dependencies.
// Node's runtime resolver avoids Turbopack rewriting this path to build-time /ROOT.
const { resolveVTimezoneToIana } = runtimeRequire(path.join(path.dirname(runtimeRequire.resolve("node-ical/package.json")), "lib/tz-utils.js"));

function propertyText(value) {
  return typeof value === "string" ? value : typeof value?.val === "string" ? value.val : "";
}
function plain(value, limit) {
  return propertyText(value).replace(/\s+/g, " ").trim().slice(0, limit).replace(/[\uD800-\uDBFF]$/, "");
}
function separator(value, delimiter, start = 0) {
  let quoted = false;
  for (let index = start; index < value.length; index++) {
    if (value[index] === '"') quoted = !quoted;
    else if (!quoted && value[index] === delimiter) return index;
  }
  return -1;
}
function contentLine(line) {
  const colon = separator(line, ":");
  if (colon < 1) throw new Error("Invalid content line");
  const header = line.slice(0, colon); const parts = []; let start = 0;
  for (let end = separator(header, ";"); end !== -1; end = separator(header, ";", start)) {
    parts.push(header.slice(start, end)); start = end + 1;
  }
  parts.push(header.slice(start));
  const name = parts[0].toUpperCase();
  const params = parts.slice(1).map(param => {
    const equals = param.indexOf("="); if (equals < 1) throw new Error("Invalid parameter");
    const key = param.slice(0, equals).toUpperCase(); const value = param.slice(equals + 1);
    return { key, value: key === "VALUE" ? value.toUpperCase() : value };
  });
  return { name, params, value: line.slice(colon + 1) };
}
function serialize(field) {
  // UID parameters are metadata, not identity. node-ical otherwise indexes the
  // parameter object as "[object Object]", merging different UIDs accidentally.
  if (field.name === "UID") return `UID:${field.value}`;
  // node-ical splits on the first colon even inside quoted parameters. Those
  // extension/alternate-representation metadata are unused by this agenda.
  const params = field.params.filter(param => {
    if (!param.value.includes(":")) return true;
    if (["TZID", "VALUE"].includes(param.key)) throw new Error("Unsupported calendar parameter");
    return false;
  });
  return `${field.name}${params.map(param => `;${param.key}=${param.value}`).join("")}:${field.value}`;
}
const CASELESS_VALUES = new Set(["BEGIN", "END", "STATUS", "RRULE", "EXRULE", "DTSTART", "DTEND", "DTSTAMP", "RECURRENCE-ID", "EXDATE", "RDATE", "CREATED", "LAST-MODIFIED", "DURATION"]);
function normalizedLines(document) {
  return document.replace(/^\uFEFF/, "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/).filter(line => line.length > 0).map(line => {
    const field = contentLine(line);
    if (CASELESS_VALUES.has(field.name)) field.value = field.value.toUpperCase();
    return field;
  });
}
function namedZone(value) {
  if (!/^[A-Za-z]/.test(value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}
function prepareCalendar(document, timezone) {
  const lines = normalizedLines(document);
  if (lines[0]?.name !== "BEGIN" || lines[0].value !== "VCALENDAR" || lines.at(-1)?.name !== "END" || lines.at(-1).value !== "VCALENDAR") throw new Error("Invalid calendar");
  const stack = []; const timezoneFields = new Set(); const definitions = new Map(); let activeZone = null;
  for (const field of lines) {
    if (field.name === "BEGIN") {
      if (field.value === "VCALENDAR" && field !== lines[0]) throw new Error("Nested calendar");
      if (field.value === "VTIMEZONE" && stack.at(-1) !== "VCALENDAR") throw new Error("Invalid timezone component");
      if (field.value === "VTIMEZONE") activeZone = { field: null, standardOffset: false };
      stack.push(field.value); if (stack.length > 40) throw new Error("Calendar nesting limit");
    }
    if (stack.includes("VTIMEZONE")) timezoneFields.add(field);
    if (field.name === "TZID" && stack.at(-1) === "VTIMEZONE") {
      const id = field.value.replace(/^"(.*)"$/, "$1");
      if (!id || definitions.has(id) || activeZone.field) throw new Error("Ambiguous timezone");
      activeZone.field = field; definitions.set(id, { field, zone: activeZone });
    }
    if (field.name === "TZOFFSETTO" && stack.at(-1) === "STANDARD" && activeZone) {
      const offset = /^([+-])(\d{2}):?(\d{2})$/.exec(field.value);
      if (offset && Number(offset[2]) <= 14 && Number(offset[3]) < 60 && (Number(offset[2]) < 14 || Number(offset[3]) === 0)) activeZone.standardOffset = true;
    }
    if (field.name === "RECURRENCE-ID" && field.params.some(param => param.key === "RANGE")) throw new Error("Unsupported recurrence range");
    if (field.name === "END" && stack.pop() !== field.value) throw new Error("Invalid calendar nesting");
    if (field.name === "END" && field.value === "VTIMEZONE") activeZone = null;
  }
  if (stack.length) throw new Error("Unclosed calendar component");
  const zoneMap = new Map(); const aliases = new Set();
  for (const [id, definition] of definitions) {
    // Route arbitrary embedded IDs through node-ical's VTIMEZONE resolver,
    // instead of letting unknown names silently use the server's local zone.
    const known = namedZone(id);
    if (!known && !definition.zone.standardOffset) throw new Error("Unsupported timezone definition");
    const mapped = known ? id : `Customized Time Zone Kokpit ${zoneMap.size + 1}`;
    zoneMap.set(id, mapped); definition.field.value = mapped;
    if (!known) aliases.add(mapped);
  }
  const declared = lines.find(field => field.name === "X-WR-TIMEZONE")?.value.trim() || timezone;
  const zone = zoneMap.get(declared) ?? declared;
  if (!namedZone(zone) && !aliases.has(zone)) throw new Error("Invalid timezone");
  let inEvent = false; const customYears = new Map();
  for (const field of lines) {
    for (const param of field.params) if (param.key === "TZID") {
      const id = param.value.replace(/^"(.*)"$/, "$1");
      if (zoneMap.has(id)) param.value = `"${zoneMap.get(id)}"`;
      else if (!namedZone(id)) throw new Error("Timezone identifier has no definition");
    }
    if (field.name === "BEGIN" && field.value === "VEVENT") inEvent = true;
    if (field.name === "END" && field.value === "VEVENT") inEvent = false;
    // VTIMEZONE observances are local transition rules, not event instants.
    if (inEvent && ["DTSTART", "DTEND", "RECURRENCE-ID", "EXDATE", "RDATE"].includes(field.name)
      && !field.params.some(param => param.key === "TZID") && /^\d{8}T\d{6}(?:,\d{8}T\d{6})*$/.test(field.value)) field.params.push({ key: "TZID", value: `"${zone}"` });
    if (inEvent && ["DTSTART", "DTEND", "RECURRENCE-ID", "EXDATE", "RDATE"].includes(field.name)) {
      const id = field.params.find(param => param.key === "TZID")?.value.replace(/^"(.*)"$/, "$1");
      if (id && aliases.has(id)) {
        const years = customYears.get(id) ?? new Set(); customYears.set(id, years);
        for (const date of field.value.split(",")) {
          const year = /^(\d{4})\d{4}T\d{6}$/.exec(date);
          if (!year) throw new Error("Invalid custom timezone date");
          years.add(Number(year[1]));
        }
      }
    }
  }
  const zones = [...timezoneFields]; const core = lines.filter(field => !timezoneFields.has(field));
  const timezoneContext = zones.map(serialize).join("\r\n");
  if (customYears.size) {
    const parsedZones = Object.values(ical.sync.parseICS(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${timezoneContext}\r\nEND:VCALENDAR\r\n`));
    for (const [id, years] of customYears) {
      const definition = parsedZones.find(component => component?.type === "VTIMEZONE" && propertyText(component.tzid) === id);
      for (const year of years) {
        const resolved = resolveVTimezoneToIana(definition, year);
        if (!resolved.iana && !resolved.offset) throw new Error("Unsupported timezone definition");
      }
    }
  }
  const firstComponent = core.findIndex((field, index) => index > 0 && field.name === "BEGIN");
  const insertion = firstComponent === -1 ? core.length - 1 : firstComponent;
  // Definitions may legally follow events; the dependency needs them first.
  const ordered = [...core.slice(0, insertion), ...zones, ...core.slice(insertion)];
  return { document: ordered.map(serialize).join("\r\n"), timezoneContext, aliases };
}
function resolvedDate(date, aliases) {
  if (aliases.has(date?.tz)) throw new Error("Unsupported timezone definition");
}
function day(date, timezone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function calendarDay(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
// node-ical exposes RDATE fields but its expansion helper only expands RRULE.
// Feed explicit dates through that same helper to preserve exclusions/overrides.
function additionalDates(event, timezoneContext, aliases) {
  return (Array.isArray(event.rdate) ? event.rdate : event.rdate ? [event.rdate] : []).flatMap(value => {
    const params = typeof value === "string" ? "" : Object.entries(value.params ?? {}).map(([key, val]) => `;${key}=${val}`).join("");
    return (typeof value === "string" ? value : value.val).split(",").map(raw => {
      if (raw.includes("/")) throw new Error("Unsupported recurrence period");
      const parsed = ical.sync.parseICS(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${timezoneContext}\r\nBEGIN:VEVENT\r\nUID:rdate\r\nDTSTART${params}:${raw}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`).rdate;
      if (!parsed?.start || !Number.isFinite(parsed.start.getTime())) throw new Error("Invalid recurrence date");
      resolvedDate(parsed.start, aliases);
      return parsed.start;
    });
  });
}
function safeUrl(value) {
  try { const url = new URL(propertyText(value)); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function parseCalendars({ documents, now, until, timezone }) {
  const from = new Date(now); const to = new Date(until);
  const firstDay = day(from, timezone); const finalDay = day(to, timezone);
  const finalDayIncluded = to.getUTCMilliseconds() !== 0 || new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(to) !== "00:00:00";
  const events = new Map();
  for (const input of documents) {
    const { document, timezoneContext, aliases } = prepareCalendar(input, timezone);
    const parsed = ical.sync.parseICS(document);
    for (const event of Object.values(parsed)) {
      if (event?.type !== "VEVENT") continue;
      if (!event.start || !Number.isFinite(event.start.getTime()) || !event.uid) throw new Error("Invalid event");
      resolvedDate(event.start, aliases); resolvedDate(event.end, aliases);
      if (propertyText(event.status).toUpperCase() === "CANCELLED") continue;
      // A server-side expanded calendar may contain detached RECURRENCE-ID events.
      // node-ical merges them by UID; expandRecurringEvent applies overrides.
      const range = { from: new Date(from.getTime() - 86_400_000), to, expandOngoing: true };
      const instances = ical.expandRecurringEvent(event.rrule ? event : { ...event, rrule: { between: () => [event.start] } }, range);
      for (const date of additionalDates(event, timezoneContext, aliases)) {
        instances.push(...ical.expandRecurringEvent({ ...event, rrule: { between: () => [date] } }, range));
      }
      for (const instance of instances) {
        const source = instance.event;
        if (propertyText(source.status).toUpperCase() === "CANCELLED") continue;
        if (!Number.isFinite(instance.start.getTime()) || !Number.isFinite(instance.end.getTime())) throw new Error("Invalid date");
        resolvedDate(instance.start, aliases); resolvedDate(instance.end, aliases);
        const allDay = instance.isFullDay;
        const start = allDay ? calendarDay(instance.start) : instance.start.toISOString();
        const end = allDay ? calendarDay(instance.end) : instance.end.toISOString();
        if (allDay ? end <= start : end < start) throw new Error("Invalid duration");
        const inWindow = allDay ? (start < finalDay || (start === finalDay && finalDayIncluded)) && end > firstDay
          : instance.start < to && (instance.end > from || (instance.end.getTime() === instance.start.getTime() && instance.start >= from));
        if (!inWindow) continue;
        const recurrence = source.recurrenceid ? source.recurrenceid.dateOnly ? calendarDay(source.recurrenceid) : source.recurrenceid.toISOString() : start;
        const id = JSON.stringify(event.rrule || event.rdate || event.recurrences || event.recurrenceid ? [event.uid, recurrence] : [event.uid]);
        events.set(id, { id, title: plain(instance.summary, 300) || "Untitled event", start, end, allDay,
          description: plain(source.description, 500), location: plain(source.location, 200), url: safeUrl(source.url),
          tentative: propertyText(source.status).toUpperCase() === "TENTATIVE", ongoing: !allDay && instance.start < from && instance.end > from });
        if (events.size > 5000) throw new Error("Too many events");
      }
    }
  }
  return [...events.values()];
}
module.exports = { parseCalendars };
if (parentPort) {
  try { parentPort.postMessage({ events: parseCalendars(workerData) }); }
  catch { parentPort.postMessage({ error: true }); }
}
