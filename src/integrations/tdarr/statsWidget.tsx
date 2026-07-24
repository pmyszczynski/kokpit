import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchTdarrStats, TdarrConfigSchema } from "./api";
import type { TdarrConfig, TdarrStats } from "./api";

// Space saved is a storage metric that commonly reaches TB on a busy Tdarr
// install, so we use a TB-aware decimal formatter (matching the Immich stats
// widget) rather than qBittorrent's GB-capped download formatter.
function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000_000) {
    return `${(bytes / 1_000_000_000_000).toFixed(1)} TB`;
  }
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  }
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }
  if (bytes >= 1_000) {
    return `${(bytes / 1_000).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

export function TdarrStatsWidget({
  data,
  loading,
  error,
  refresh: _refresh,
}: WidgetProps<TdarrStats>) {
  if (!data) {
    return (
      <div className="tdarr-stats-widget tdarr-stats-widget--empty">
        {loading && (
          <span className="tdarr-stats-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="tdarr-stats-widget__hint tdarr-stats-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="tdarr-stats-widget" aria-label="Tdarr stats">
      <div className="tdarr-stats-widget__stat">
        <span className="tdarr-stats-widget__value">{data.transcodeQueue}</span>
        <span className="tdarr-stats-widget__label">Transcode Queue</span>
      </div>
      <div className="tdarr-stats-widget__stat">
        <span className="tdarr-stats-widget__value">{data.healthCheckQueue}</span>
        <span className="tdarr-stats-widget__label">Health Checks</span>
      </div>
      <div className="tdarr-stats-widget__stat">
        <span className="tdarr-stats-widget__value">{data.errored}</span>
        <span className="tdarr-stats-widget__label">Errored</span>
      </div>
      <div className="tdarr-stats-widget__stat">
        <span className="tdarr-stats-widget__value">
          {formatBytes(data.spaceSavedGb * 1_000_000_000)}
        </span>
        <span className="tdarr-stats-widget__label">Space Saved</span>
      </div>
      <div className="tdarr-stats-widget__stat">
        <span className="tdarr-stats-widget__value">{data.activeWorkers}</span>
        <span className="tdarr-stats-widget__label">Workers</span>
      </div>
      <div className="tdarr-stats-widget__stat">
        <span className="tdarr-stats-widget__value">{data.fps.toFixed(1)}</span>
        <span className="tdarr-stats-widget__label">FPS</span>
      </div>
      {error && (
        <span className="tdarr-stats-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<TdarrConfig, TdarrStats>({
  id: "tdarr-stats",
  name: "Tdarr Stats",
  preferredSize: "wide",
  serviceEditorPreset: {
    defaultName: "Tdarr",
    defaultIconUrl: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/tdarr.svg",
  },
  configSchema: TdarrConfigSchema,
  fetchData: fetchTdarrStats,
  refreshInterval: 10_000,
  component: TdarrStatsWidget,
  configFields: [
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:8265",
    },
    {
      key: "apikey",
      label: "API Key (optional)",
      type: "password",
      required: false,
    },
  ],
});
