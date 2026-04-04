import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
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

export function SonarrCalendarWidget({
  data,
  loading,
  error,
  refresh: _refresh,
}: WidgetProps<SonarrEpisode[]>) {
  if (!data) {
    return (
      <div className="sonarr-calendar-widget sonarr-calendar-widget--empty">
        {loading && (
          <span className="sonarr-calendar-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="sonarr-calendar-widget__hint sonarr-calendar-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="sonarr-calendar-widget sonarr-calendar-widget--empty">
        <span className="sonarr-calendar-widget__hint">
          No upcoming episodes
        </span>
        {error && (
          <span className="sonarr-calendar-widget__stale-error" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="sonarr-calendar-widget" aria-label="Sonarr calendar">
      <div className="sonarr-calendar-widget__list">
        {data.map((episode) => (
          <div key={episode.id} className="sonarr-calendar-widget__row">
            <span className="sonarr-calendar-widget__airtime">
              {formatAirDate(episode.airDateUtc)}
            </span>
            <div className="sonarr-calendar-widget__info">
              <span
                className="sonarr-calendar-widget__title"
                title={episode.seriesTitle}
              >
                {episode.seriesTitle}
              </span>
              <span className="sonarr-calendar-widget__ep">
                {formatEpCode(episode.seasonNumber, episode.episodeNumber)}
                {" · "}
                {episode.title}
              </span>
            </div>
            <span
              className={`sonarr-calendar-widget__badge${episode.hasFile ? " sonarr-calendar-widget__badge--downloaded" : " sonarr-calendar-widget__badge--upcoming"}`}
            >
              {episode.hasFile ? "downloaded" : "upcoming"}
            </span>
          </div>
        ))}
      </div>
      {error && (
        <span className="sonarr-calendar-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<SonarrConfig, SonarrEpisode[]>({
  id: "sonarr-calendar",
  name: "Sonarr Calendar",
  serviceEditorPreset: {
    defaultName: "Sonarr",
    defaultIconUrl: "https://cdn.simpleicons.org/sonarr/35c5f4",
  },
  configSchema: SonarrConfigSchema,
  fetchData: fetchCalendar,
  refreshInterval: 60_000,
  component: SonarrCalendarWidget,
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
