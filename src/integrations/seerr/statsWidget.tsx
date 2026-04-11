import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchStats, SeerrConfigSchema } from "./api";
import type { SeerrConfig, SeerrStats } from "./api";

export function SeerrStatsWidget({
  data,
  loading,
  error,
}: WidgetProps<SeerrStats>) {
  if (!data) {
    return (
      <div className="seerr-stats-widget seerr-stats-widget--empty">
        {loading && (
          <span className="seerr-stats-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="seerr-stats-widget__hint seerr-stats-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="seerr-stats-widget" aria-label="Seerr stats">
      <div className="seerr-stats-widget__grid">
        <div className="seerr-stats-widget__stat seerr-stats-widget__stat--pending">
          <span className="seerr-stats-widget__value">{data.pending}</span>
          <span className="seerr-stats-widget__label">Pending</span>
        </div>
        <div className="seerr-stats-widget__stat seerr-stats-widget__stat--approved">
          <span className="seerr-stats-widget__value">{data.approved}</span>
          <span className="seerr-stats-widget__label">Approved</span>
        </div>
        <div className="seerr-stats-widget__stat seerr-stats-widget__stat--available">
          <span className="seerr-stats-widget__value">{data.available}</span>
          <span className="seerr-stats-widget__label">Available</span>
        </div>
        <div className="seerr-stats-widget__stat seerr-stats-widget__stat--total">
          <span className="seerr-stats-widget__value">{data.total}</span>
          <span className="seerr-stats-widget__label">Total</span>
        </div>
      </div>
      {error && (
        <span className="seerr-stats-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<SeerrConfig, SeerrStats>({
  id: "seerr-stats",
  name: "Seerr Stats",
  configSchema: SeerrConfigSchema,
  fetchData: fetchStats,
  refreshInterval: 60_000,
  component: SeerrStatsWidget,
  configFields: [
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:5055",
      description: "Works with Seerr, Jellyseerr, and Overseerr",
    },
    { key: "api_key", label: "API Key", type: "password", required: true },
  ],
  serviceEditorPreset: {
    defaultName: "Seerr",
    // Seerr brand color #615fff. Not yet on simpleicons (PR #14462 pending).
    defaultIconUrl:
      "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons@main/svg/seerr.svg",
  },
});
