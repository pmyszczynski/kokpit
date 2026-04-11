import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchStats, ProwlarrConfigSchema } from "./api";
import type { ProwlarrConfig, ProwlarrStats } from "./api";

export function ProwlarrStatsWidget({
  data,
  loading,
  error,
  refresh: _refresh,
}: WidgetProps<ProwlarrStats>) {
  if (!data) {
    return (
      <div className="prowlarr-stats-widget prowlarr-stats-widget--empty">
        {loading && (
          <span className="prowlarr-stats-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="prowlarr-stats-widget__hint prowlarr-stats-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="prowlarr-stats-widget" aria-label="Prowlarr stats">
      <div className="prowlarr-stats-widget__stat">
        <span className="prowlarr-stats-widget__value">{data.totalIndexers}</span>
        <span className="prowlarr-stats-widget__label">Indexers</span>
      </div>
      <div className="prowlarr-stats-widget__stat">
        <span className="prowlarr-stats-widget__value">{data.enabledIndexers}</span>
        <span className="prowlarr-stats-widget__label">Enabled</span>
      </div>
      <div className="prowlarr-stats-widget__stat">
        <span
          className={`prowlarr-stats-widget__value${data.failingIndexers > 0 ? " prowlarr-stats-widget__value--alert" : ""}`}
        >
          {data.failingIndexers}
        </span>
        <span className="prowlarr-stats-widget__label">Failing</span>
      </div>
      <div className="prowlarr-stats-widget__stat">
        <span className="prowlarr-stats-widget__value">
          {data.totalGrabs.toLocaleString()}
        </span>
        <span className="prowlarr-stats-widget__label">Total Grabs</span>
      </div>
      {error && (
        <span className="prowlarr-stats-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<ProwlarrConfig, ProwlarrStats>({
  id: "prowlarr-stats",
  name: "Prowlarr Stats",
  serviceEditorPreset: {
    defaultName: "Prowlarr",
    defaultIconUrl: "https://cdn.simpleicons.org/prowlarr",
  },
  configSchema: ProwlarrConfigSchema,
  fetchData: fetchStats,
  refreshInterval: 60_000,
  component: ProwlarrStatsWidget,
  configFields: [
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:9696",
    },
    {
      key: "api_key",
      label: "API Key",
      type: "password",
      required: true,
    },
  ],
});
