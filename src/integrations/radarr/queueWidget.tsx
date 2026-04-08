import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchQueue, RadarrConfigSchema } from "./api";
import type { RadarrConfig, RadarrQueueItem } from "./api";
import { calcProgress } from "@/integrations/shared/queue";

export function RadarrQueueWidget({
  data,
  loading,
  error,
  refresh: _refresh,
}: WidgetProps<RadarrQueueItem[]>) {
  if (!data) {
    return (
      <div className="radarr-queue-widget radarr-queue-widget--empty">
        {loading && (
          <span className="radarr-queue-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="radarr-queue-widget__hint radarr-queue-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="radarr-queue-widget radarr-queue-widget--empty">
        <span className="radarr-queue-widget__hint">Queue is empty</span>
        {error && (
          <span className="radarr-queue-widget__stale-error" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="radarr-queue-widget" aria-label="Radarr queue">
      <div className="radarr-queue-widget__header">
        <span>Name</span>
        <span>Progress</span>
        <span>Status</span>
        <span>ETA</span>
      </div>
      <div className="radarr-queue-widget__list">
        {data.map((item) => {
          const pct = calcProgress(item.size, item.sizeleft);
          const showStatusBadge =
            item.trackedDownloadStatus &&
            item.trackedDownloadStatus.toLowerCase() !== "ok";
          return (
            <div key={item.id} className="radarr-queue-widget__row">
              <span className="radarr-queue-widget__name" title={item.title}>
                {item.movieTitle}
              </span>
              <div className="radarr-queue-widget__progress-cell">
                <div className="radarr-queue-widget__progress-bar">
                  <div
                    className="radarr-queue-widget__progress-fill"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="radarr-queue-widget__progress-text">
                  {pct}%
                </span>
              </div>
              <span
                className={`radarr-queue-widget__status${showStatusBadge ? ` radarr-queue-widget__status--${item.trackedDownloadStatus.toLowerCase()}` : ""}`}
              >
                {item.status}
              </span>
              <span className="radarr-queue-widget__timeleft">
                {item.timeleft ?? "—"}
              </span>
            </div>
          );
        })}
      </div>
      {error && (
        <span className="radarr-queue-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<RadarrConfig, RadarrQueueItem[]>({
  id: "radarr-queue",
  name: "Radarr Queue",
  serviceEditorPreset: {
    defaultName: "Radarr",
    defaultIconUrl: "https://cdn.simpleicons.org/radarr/ffc230",
  },
  configSchema: RadarrConfigSchema,
  fetchData: fetchQueue,
  refreshInterval: 15_000,
  component: RadarrQueueWidget,
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
