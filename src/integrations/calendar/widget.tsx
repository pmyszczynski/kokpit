import { registerIntegration, registerWidget, type WidgetProps, type WidgetConfigField } from "@/widgets";
import { WidgetBody, WidgetList, WidgetListItem, WidgetBadge, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import { CalendarConfigSchema, CalendarConnectionSchema, fetchCalendar, eventUrl, type CalendarConfig, type CalendarData, type AgendaEvent } from "./api";
import "./widget.css";

function dateLabel(event: AgendaEvent, timezone: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: event.allDay ? "UTC" : timezone }).format(new Date(event.allDay ? `${event.start}T12:00:00Z` : event.start));
}
function eventTime(event: AgendaEvent, timezone: string) {
  if (event.allDay) {
    const last = new Date(`${event.end}T12:00:00Z`); last.setUTCDate(last.getUTCDate() - 1);
    return event.end > event.start && last.toISOString().slice(0, 10) > event.start
      ? `All day · through ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(last)}` : "All day";
  }
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: timezone });
  const day = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone });
  const end = day.format(new Date(event.start)) === day.format(new Date(event.end)) ? time.format(new Date(event.end)) : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(new Date(event.end));
  return event.start === event.end ? time.format(new Date(event.start)) : `${time.format(new Date(event.start))}–${end}`;
}
export function CalendarWidget({ data, loading, error, footprint }: WidgetProps<CalendarData>) {
  if (!data) return <WidgetBody centered className="calendar-widget"><WidgetState state={loading ? "loading" : error ? "error" : "empty"}>{!loading ? error ?? "Calendar unavailable" : undefined}</WidgetState></WidgetBody>;
  const detailed = (footprint?.columnSpan ?? 3) >= 6;
  return <WidgetBody className="calendar-widget" reserveNotice noticeClassName="calendar-widget__notice" notice={<><WidgetStaleNotice error={error} /><span className="calendar-widget__timezone" title={data.timezone}>{data.timezone}</span></>}>
    <WidgetList label="Upcoming calendar events" summary={{ primary: `Next ${data.daysAhead} ${data.daysAhead === 1 ? "day" : "days"}`, secondary: `${data.events.length} ${data.events.length === 1 ? "event" : "events"}` }}
      empty={data.events.length === 0 ? <WidgetState state="empty">No upcoming events</WidgetState> : undefined}>
      {data.events.map(event => {
        const url = event.url ? eventUrl(event.url) : null;
        const secondary = [eventTime(event, data.timezone), event.ongoing ? "In progress" : "", event.tentative ? "Tentative" : "", detailed ? event.location : ""].filter(Boolean).join(" · ");
        return <WidgetListItem key={event.id} titleTooltip={event.title}
          leading={<WidgetBadge tone="info"><time dateTime={event.start}>{dateLabel(event, data.timezone)}</time></WidgetBadge>}
          title={url ? <a className="calendar-widget__link" href={url} target="_blank" rel="noopener noreferrer">{event.title}</a> : event.title}
          secondary={secondary} wrapSecondary={detailed}
          footer={detailed && event.description ? <span className="calendar-widget__description" title={event.description}>{event.description}</span> : undefined} />;
      })}
    </WidgetList>
  </WidgetBody>;
}
const CONNECTION: WidgetConfigField[] = [
  { key: "calendar", label: "Calendar", type: "text", required: true, placeholder: "https://cloud.example.com/remote.php/dav/calendars/me/personal/", description: "CalDAV calendar collection URL, or a public Google calendar ID (an email address)." },
  { key: "username", label: "CalDAV username", type: "text", description: "Leave empty for an unauthenticated collection or Google Calendar." },
  { key: "password", label: "CalDAV password", type: "password", description: "Use an app password where supported. Credentials stay on the server." },
  { key: "api_key", label: "Google API key", type: "password", description: "For public Google calendars only. Enable Google Calendar API for this key; leave empty for CalDAV." },
];
const OPTIONS: Exclude<WidgetConfigField, { type: "password" }>[] = [
  { key: "days_ahead", label: "Days ahead", type: "number", defaultValue: 7, description: "Upcoming window, 1–30 days; includes events already in progress." },
  { key: "max_items", label: "Event limit", type: "number", defaultValue: 10, description: "Show 1–50 events in start-time order, in either size." },
  { key: "timezone", label: "Time zone", type: "text", defaultValue: "UTC", placeholder: "Europe/Warsaw", description: "IANA time zone for event times; all-day dates keep their calendar day." },
];
registerIntegration({ id: "calendar", connectionSchema: CalendarConnectionSchema, connectionFields: CONNECTION, credentialScopeFields: ["calendar"] });
registerWidget<CalendarConfig, CalendarData>({ id: "calendar", name: "Calendar", integrationType: "calendar", configSchema: CalendarConfigSchema,
  fetchData: fetchCalendar, component: CalendarWidget, refreshInterval: 300_000, fetchTimeoutMs: 15_000, compactHeader: true, sharedUI: true, hasLinks: true,
  preferredSize: "tall", supportedFootprints: [{ label: "Agenda", columnSpan: 3, rowSpan: 4 }, { label: "Detailed", columnSpan: 6, rowSpan: 4 }],
  configFields: [...CONNECTION, ...OPTIONS], optionFields: OPTIONS, credentialScopeFields: ["calendar"],
  serviceEditorPreset: { defaultName: "Calendar", defaultIconUrl: "/icons/calendar.svg" },
});
