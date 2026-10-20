import { z } from "zod";

export function eventUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function calendarUrl(value: string): string | null {
  const url = eventUrl(value);
  return url && !new URL(url).hash ? url : null;
}
const ConnectionFields = z.object({
  calendar: z.string().trim().min(1).max(2048),
  username: z.string().max(500).default(""),
  password: z.string().max(4096).default(""),
  api_key: z.string().max(4096).default(""),
});
function checkConnection(value: z.output<typeof ConnectionFields>, ctx: z.RefinementCtx) {
  if (/^https?:/i.test(value.calendar)) {
    if (!calendarUrl(value.calendar)) ctx.addIssue({ code: "custom", path: ["calendar"], message: "Enter an HTTP(S) CalDAV collection URL without embedded credentials or a fragment" });
    if (Boolean(value.username) !== Boolean(value.password)) ctx.addIssue({ code: "custom", path: ["password"], message: "CalDAV requires both username and password, or neither" });
    if (value.api_key) ctx.addIssue({ code: "custom", path: ["api_key"], message: "API keys are for Google calendars; leave this empty for CalDAV" });
    if (value.username.includes(":")) ctx.addIssue({ code: "custom", path: ["username"], message: "CalDAV usernames cannot contain a colon" });
  } else {
    if (!/^[^\s:/?]+@[^\s:/?#]+$/.test(value.calendar)) ctx.addIssue({ code: "custom", path: ["calendar"], message: "Enter a CalDAV HTTP(S) collection URL or a Google calendar ID (usually an email address)" });
    if (!value.api_key) ctx.addIssue({ code: "custom", path: ["api_key"], message: "A Google API key is required for public Google calendars" });
    if (value.username || value.password) ctx.addIssue({ code: "custom", path: ["username"], message: "Google API-key access does not use a username or password" });
  }
}
export const CalendarConnectionSchema = ConnectionFields.superRefine(checkConnection);
export const CalendarOptionsSchema = z.object({
  days_ahead: z.number().int().min(1).max(30).default(7),
  max_items: z.number().int().min(1).max(50).default(10),
  timezone: z.string().trim().min(1).max(100).default("UTC").refine(value => {
    if (!/^[A-Za-z]/.test(value)) return false;
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "Enter an IANA time zone, such as Europe/Warsaw"),
});
export const CalendarConfigSchema = ConnectionFields.extend(CalendarOptionsSchema.shape).superRefine(checkConnection);
export type CalendarConfig = z.input<typeof CalendarConfigSchema>;
export interface AgendaEvent {
  id: string; title: string; start: string; end: string; allDay: boolean;
  location: string; description: string; url: string | null; tentative: boolean; ongoing: boolean;
}
export interface CalendarData { events: AgendaEvent[]; timezone: string; daysAhead: number }

export async function fetchCalendar(config: CalendarConfig, signal?: AbortSignal): Promise<CalendarData> {
  if (typeof window === "undefined") {
    const { fetchAgenda } = await import("./server");
    return fetchAgenda(config, signal);
  }
  throw new Error("Calendar data is fetched server-side");
}
