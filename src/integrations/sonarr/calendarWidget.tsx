import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { WidgetBody, WidgetList, WidgetListItem, WidgetBadge, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import { fetchCalendar, SonarrConfigSchema } from "./api";
import type { SonarrConfig, SonarrEpisode } from "./api";

function formatAirDate(isoUtc: string): string {
  const d = new Date(isoUtc);
  const today = new Date();
  const dMidnight = new Date(d);
  dMidnight.setHours(0, 0, 0, 0);
  const todayMidnight = new Date(today);
  todayMidnight.setHours(0, 0, 0, 0);
  const diff = Math.round(
    (dMidnight.getTime() - todayMidnight.getTime()) / 86_400_000
  );
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

function formatEpCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

export function SonarrCalendarWidget({ data, loading, error }: WidgetProps<SonarrEpisode[]>) {
  if (!data) {
    return <WidgetBody centered className="sonarr-calendar-widget sonarr-calendar-widget--empty">
      <WidgetState state={loading ? "loading" : error ? "error" : "empty"}
        className={loading ? "sonarr-calendar-widget__hint" : undefined}
        labelClassName="sonarr-calendar-widget__hint sonarr-calendar-widget__hint--error">{!loading ? error : undefined}</WidgetState>
    </WidgetBody>;
  }
  return <WidgetBody className={`sonarr-calendar-widget${data.length === 0 ? " sonarr-calendar-widget--empty" : ""}`}
    aria-label="Sonarr calendar" reserveNotice
    notice={<WidgetStaleNotice error={error} className="sonarr-calendar-widget__stale-error" />}>
    <WidgetList label="Sonarr calendar" listClassName="sonarr-calendar-widget__list" alignAccessories
      empty={data.length === 0 ? <WidgetState state="empty" className="sonarr-calendar-widget__hint">No upcoming episodes</WidgetState> : undefined}>
      {data.map(episode => <WidgetListItem key={episode.id} className="sonarr-calendar-widget__row"
        title={episode.seriesTitle} titleClassName="sonarr-calendar-widget__title" contentClassName="sonarr-calendar-widget__info"
        secondary={`${formatEpCode(episode.seasonNumber, episode.episodeNumber)} · ${episode.title}`} secondaryClassName="sonarr-calendar-widget__ep"
        leading={<time className="sonarr-calendar-widget__airtime" dateTime={episode.airDateUtc} title={episode.airDateUtc}>{formatAirDate(episode.airDateUtc)}</time>}
        trailing={<WidgetBadge tone={episode.hasFile ? "positive" : "info"}
          className={`sonarr-calendar-widget__badge sonarr-calendar-widget__badge--${episode.hasFile ? "downloaded" : "upcoming"}`}>
          {episode.hasFile ? "downloaded" : "upcoming"}
        </WidgetBadge>} />)}
    </WidgetList>
  </WidgetBody>;
}

registerWidget<SonarrConfig, SonarrEpisode[]>({
  id: "sonarr-calendar",
  name: "Sonarr Calendar",
  preferredSize: "tall",
  compactHeader: true,
  sharedUI: true,
  sharedStateClassNames: {
    wrapper: "sonarr-calendar-widget sonarr-calendar-widget--empty",
    loading: "sonarr-calendar-widget__hint",
    error: "sonarr-calendar-widget__hint sonarr-calendar-widget__hint--error",
  },
  supportedFootprints: [{ label: "Default", columnSpan: 3, rowSpan: 4 }],
  minSize: "tall",
  serviceEditorPreset: {
    defaultName: "Sonarr",
    defaultIconUrl: "https://cdn.simpleicons.org/sonarr/35c5f4",
  },
  configSchema: SonarrConfigSchema,
  fetchData: fetchCalendar,
  refreshInterval: 60_000,
  component: SonarrCalendarWidget,
  credentialScopeFields: ["url"],
  configFields: [
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:8989",
    },
    { key: "api_key", label: "API Key", type: "password", required: true },
    {
      key: "days",
      label: "Days ahead",
      type: "number",
      placeholder: "7",
      description: "Number of days to show (1–30)",
    },
  ],
});
