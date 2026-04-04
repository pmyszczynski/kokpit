import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchQueue, SonarrConfigSchema } from "./api";
import type { SonarrConfig, SonarrQueueItem } from "./api";

function calcProgress(size: number, sizeleft: number): number {
  if (size === 0) return 0;
  return Math.min(100, Math.max(0, Math.round((1 - sizeleft / size) * 100)));
}

export function SonarrQueueWidget({
  data,
  loading,
  error,
  refresh: _refresh,
}: WidgetProps<SonarrQueueItem[]>) {
  if (!data) {
    return (
      <div className="sonarr-queue-widget sonarr-queue-widget--empty">
        {loading && (
          <span className="sonarr-queue-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="sonarr-queue-widget__hint sonarr-queue-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="sonarr-queue-widget sonarr-queue-widget--empty">
        <span className="sonarr-queue-widget__hint">Queue is empty</span>
        {error && (
          <span className="sonarr-queue-widget__stale-error" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="sonarr-queue-widget" aria-label="Sonarr queue">
      <div className="sonarr-queue-widget__header">
        <span>Name</span>
        <span>Progress</span>
        <span>Status</span>
        <span>ETA</span>
      </div>
      <div className="sonarr-queue-widget__list">
        {data.map((item) => {
          const pct = calcProgress(item.size, item.sizeleft);
          const showStatusBadge =
            item.trackedDownloadStatus &&
            item.trackedDownloadStatus.toLowerCase() !== "ok";
          return (
            <div key={item.id} className="sonarr-queue-widget__row">
              <span className="sonarr-queue-widget__name" title={item.title}>
                {item.title}
              </span>
              <div className="sonarr-queue-widget__progress-cell">
                <div className="sonarr-queue-widget__progress-bar">
                  <div
                    className="sonarr-queue-widget__progress-fill"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="sonarr-queue-widget__progress-text">
                  {pct}%
                </span>
              </div>
              <span
                className={`sonarr-queue-widget__status${showStatusBadge ? ` sonarr-queue-widget__status--${item.trackedDownloadStatus.toLowerCase()}` : ""}`}
              >
                {item.status}
              </span>
              <span className="sonarr-queue-widget__timeleft">
                {item.timeleft ?? "—"}
              </span>
            </div>
          );
        })}
      </div>
      {error && (
        <span className="sonarr-queue-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<SonarrConfig, SonarrQueueItem[]>({
  id: "sonarr-queue",
  name: "Sonarr Queue",
  serviceEditorPreset: {
    defaultName: "Sonarr",
    defaultIconUrl: "https://cdn.simpleicons.org/sonarr/35c5f4",
  },
  configSchema: SonarrConfigSchema,
  fetchData: fetchQueue,
  refreshInterval: 15_000,
  component: SonarrQueueWidget,
  configFields: [
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:8989",
    },
    { key: "api_key", label: "API Key", type: "password", required: true },
  ],
});
