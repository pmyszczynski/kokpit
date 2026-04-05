import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchStats, RadarrConfigSchema } from "./api";
import type { RadarrConfig, RadarrStats } from "./api";

export function RadarrStatsWidget({
  data,
  loading,
  error,
  refresh: _refresh,
}: WidgetProps<RadarrStats>) {
  if (!data) {
    return (
      <div className="radarr-stats-widget radarr-stats-widget--empty">
        {loading && (
          <span className="radarr-stats-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="radarr-stats-widget__hint radarr-stats-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="radarr-stats-widget" aria-label="Radarr stats">
      <div className="radarr-stats-widget__grid">
        <div className="radarr-stats-widget__stat radarr-stats-widget__stat--missing">
          <span className="radarr-stats-widget__value">{data.missing}</span>
          <span className="radarr-stats-widget__label">Missing</span>
        </div>
        <div className="radarr-stats-widget__stat radarr-stats-widget__stat--upcoming">
          <span className="radarr-stats-widget__value">{data.upcoming}</span>
          <span className="radarr-stats-widget__label">Upcoming</span>
        </div>
        <div className="radarr-stats-widget__stat radarr-stats-widget__stat--wanted">
          <span className="radarr-stats-widget__value">{data.wanted}</span>
          <span className="radarr-stats-widget__label">Wanted</span>
        </div>
        <div className="radarr-stats-widget__stat radarr-stats-widget__stat--queued">
          <span className="radarr-stats-widget__value">{data.queued}</span>
          <span className="radarr-stats-widget__label">Queued</span>
        </div>
        <div className="radarr-stats-widget__stat radarr-stats-widget__stat--available">
          <span className="radarr-stats-widget__value">{data.available}</span>
          <span className="radarr-stats-widget__label">Available</span>
        </div>
        <div className="radarr-stats-widget__stat radarr-stats-widget__stat--total">
          <span className="radarr-stats-widget__value">{data.total}</span>
          <span className="radarr-stats-widget__label">Total</span>
        </div>
      </div>
      {error && (
        <span className="radarr-stats-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<RadarrConfig, RadarrStats>({
  id: "radarr-stats",
  name: "Radarr Stats",
  serviceEditorPreset: {
    defaultName: "Radarr",
    defaultIconUrl: "https://cdn.simpleicons.org/radarr/ffc230",
  },
  configSchema: RadarrConfigSchema,
  fetchData: fetchStats,
  refreshInterval: 60_000,
  component: RadarrStatsWidget,
  configFields: [
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:7878",
    },
    { key: "api_key", label: "API Key", type: "password", required: true },
  ],
});
