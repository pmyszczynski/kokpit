import { registerIntegration, registerWidget, type WidgetProps, type WidgetConfigField } from "@/widgets";
import { WidgetBody, WidgetList, WidgetListItem, WidgetBadge, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import { CalendarConfigSchema, CalendarConnectionSchema, fetchCalendar, eventUrl, type CalendarConfig, type CalendarData, type AgendaEvent } from "./api";
import { calendarSetupGuide } from "./setupGuide";
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
  { key: "calendar", label: "Calendar", type: "text", required: true, placeholder: "https://cloud.example.com/remote.php/dav/calendars/me/personal/", description: "HTTP(S) CalDAV collection URL, or a public Google Calendar ID such as example@group.calendar.google.com. Follow the matching setup path to obtain it; discovery/share/ICS links do not work. Use the final URL/path/slash because redirects are blocked. Changing this text requires re-entering saved secrets." },
  { key: "username", label: "CalDAV username", type: "text", description: "CalDAV only: the provider’s login name, such as Login from Nextcloud’s app-password dialog. Enter both username and password, or leave both unconfigured only for an already anonymous collection. Clear this field for Google. A username cannot contain a colon. When changing accounts, also enter that account’s password." },
  { key: "password", label: "CalDAV password", type: "password", description: "For authenticated CalDAV: the provider’s password, preferably an app password where supported; follow the guide for Nextcloud’s procedure. Enter it with username. For Google or an already anonymous collection, leave unconfigured and use Clear saved credential for an old value. Credentials stay server-side; provider permissions may include writes." },
  { key: "api_key", label: "Google API key", type: "password", description: "Required for a public Google ID. Follow the Google setup path for API enablement, key creation and server-compatible restrictions. Paste the key string, not OAuth/service-account JSON. Leave unconfigured for CalDAV, using Clear saved credential for an old saved key. Saved-secret scope is described under Calendar above." },
];
const OPTIONS: Exclude<WidgetConfigField, { type: "password" }>[] = [
  { key: "days_ahead", label: "Days ahead", type: "number", defaultValue: 7, description: "Rolling upcoming window, 1–30 days; default 7. Starts at the last fetch and extends by that many 24-hour periods. Includes events already in progress; events that ended earlier today are excluded. This does not select a calendar month or start at midnight." },
  { key: "max_items", label: "Event limit", type: "number", defaultValue: 10, description: "Maximum displayed events, 1–50; default 10, in either footprint. Events are ordered by local day, with all-day entries before timed entries on that day. The header count is capped by this limit. Detailed adds information, not more rows; the list scrolls." },
  { key: "timezone", label: "Time zone", type: "text", defaultValue: "UTC", placeholder: "Europe/Warsaw", description: "Valid IANA time zone, e.g. UTC, Europe/Warsaw or America/New_York; default UTC. Controls timed-event display and day boundaries. Floating CalDAV times use X-WR-TIMEZONE when provided, otherwise this setting. All-day dates keep their calendar day. Invalid names are rejected rather than silently replaced." },
];
registerIntegration({ id: "calendar", connectionSchema: CalendarConnectionSchema, connectionFields: CONNECTION, credentialScopeFields: ["calendar"] });
registerWidget<CalendarConfig, CalendarData>({ id: "calendar", name: "Calendar", integrationType: "calendar", configSchema: CalendarConfigSchema,
  fetchData: fetchCalendar, component: CalendarWidget, refreshInterval: 300_000, fetchTimeoutMs: 15_000, compactHeader: true, sharedUI: true, hasLinks: true,
  preferredSize: "tall", supportedFootprints: [{ label: "Agenda", columnSpan: 3, rowSpan: 4 }, { label: "Detailed", columnSpan: 6, rowSpan: 4 }],
  setupGuide: calendarSetupGuide,
  footprintDescription: "Agenda (3×4) and Detailed (6×4) use the same window, event limit and scrolling agenda. Both show date, title, time or all-day range, and Tentative/In progress labels when applicable. Detailed adds location, descriptions and wrapped secondary text. All-day entries come before timed entries on a local day; times then run earliest first. The visible time-zone label comes from the tile’s setting. There is no second calendar or measurement selector.",
  configFields: [...CONNECTION, ...OPTIONS], optionFields: OPTIONS, credentialScopeFields: ["calendar"],
  serviceEditorPreset: { defaultName: "Calendar", defaultIconUrl: "/icons/calendar.svg" },
});
