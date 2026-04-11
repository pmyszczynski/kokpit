import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchStats, ImmichConfigSchema } from "./api";
import type { ImmichConfig, ImmichStats } from "./api";

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

export function ImmichStatsWidget({
  data,
  loading,
  error,
}: WidgetProps<ImmichStats>) {
  if (!data) {
    return (
      <div className="immich-stats-widget immich-stats-widget--empty">
        {loading && (
          <span className="immich-stats-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="immich-stats-widget__hint immich-stats-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="immich-stats-widget" aria-label="Immich stats">
      <div className="immich-stats-widget__grid">
        <div className="immich-stats-widget__stat immich-stats-widget__stat--photos">
          <span className="immich-stats-widget__value">{data.photos.toLocaleString()}</span>
          <span className="immich-stats-widget__label">Photos</span>
        </div>
        <div className="immich-stats-widget__stat immich-stats-widget__stat--videos">
          <span className="immich-stats-widget__value">{data.videos.toLocaleString()}</span>
          <span className="immich-stats-widget__label">Videos</span>
        </div>
        <div className="immich-stats-widget__stat immich-stats-widget__stat--usage">
          <span className="immich-stats-widget__value">{formatBytes(data.usage)}</span>
          <span className="immich-stats-widget__label">Storage</span>
        </div>
        <div className="immich-stats-widget__stat immich-stats-widget__stat--usage-photos">
          <span className="immich-stats-widget__value">{formatBytes(data.usagePhotos)}</span>
          <span className="immich-stats-widget__label">Photo Size</span>
        </div>
        <div className="immich-stats-widget__stat immich-stats-widget__stat--usage-videos">
          <span className="immich-stats-widget__value">{formatBytes(data.usageVideos)}</span>
          <span className="immich-stats-widget__label">Video Size</span>
        </div>
      </div>
      {error && (
        <span className="immich-stats-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<ImmichConfig, ImmichStats>({
  id: "immich-stats",
  name: "Immich Stats",
  configSchema: ImmichConfigSchema,
  fetchData: fetchStats,
  refreshInterval: 60_000,
  component: ImmichStatsWidget,
  configFields: [
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:2283/api",
      description: "Immich API base URL, usually ending with /api",
    },
    { key: "api_key", label: "API Key", type: "password", required: true },
  ],
  serviceEditorPreset: {
    defaultName: "Immich",
    defaultIconUrl: "https://cdn.simpleicons.org/immich",
  },
});
