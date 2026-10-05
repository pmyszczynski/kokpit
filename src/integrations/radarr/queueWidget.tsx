import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchQueue, RadarrConfigSchema } from "./api";
import type { RadarrConfig, RadarrQueueItem } from "./api";
import { WidgetBody, WidgetList, WidgetListItem, WidgetBar, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import { calcProgress } from "@/integrations/shared/queue";

export function RadarrQueueWidget({ data, loading, error }: WidgetProps<RadarrQueueItem[]>) {
  if (!data) {
    return <WidgetBody centered className="radarr-queue-widget radarr-queue-widget--empty">
      <WidgetState state={loading ? "loading" : error ? "error" : "empty"}
        className={loading ? "radarr-queue-widget__hint" : undefined}
        labelClassName="radarr-queue-widget__hint radarr-queue-widget__hint--error">{!loading ? error : undefined}</WidgetState>
    </WidgetBody>;
  }
  return <WidgetBody className={`radarr-queue-widget${data.length === 0 ? " radarr-queue-widget--empty" : ""}`}
    aria-label="Radarr queue" reserveNotice
    notice={<WidgetStaleNotice error={error} className="radarr-queue-widget__stale-error" />}>
    <WidgetList label="Radarr queue" listClassName="radarr-queue-widget__list"
      columnLabels={["Name", "Progress", "Status", "ETA"]} columnsClassName="radarr-queue-widget__header"
      empty={data.length === 0 ? <WidgetState state="empty" className="radarr-queue-widget__hint">Queue is empty</WidgetState> : undefined}>
      {data.map(item => {
        const pct = calcProgress(item.size, item.sizeleft);
        const tracked = item.trackedDownloadStatus?.toLowerCase();
        const tone = tracked === "warning" ? "warning" : tracked === "error" ? "alert" : "neutral";
        const statusClass = tracked && tracked !== "ok" ? ` radarr-queue-widget__status--${tracked}` : "";
        return <WidgetListItem key={item.id} className="radarr-queue-widget__row" title={item.movieTitle} titleTooltip={item.title}
          titleClassName="radarr-queue-widget__name" columns={[
            { content: <WidgetBar label={`Download progress for ${item.movieTitle}`} value={pct} valueLabel={`${pct}%`} tone="positive"
              className="radarr-queue-widget__progress-cell" trackClassName="radarr-queue-widget__progress-bar"
              fillClassName="radarr-queue-widget__progress-fill" labelClassName="radarr-queue-widget__progress-text" /> },
            { content: item.status, tone, className: `radarr-queue-widget__status${statusClass}` },
            { content: item.timeleft ?? "—", className: "radarr-queue-widget__timeleft" },
          ]} />;
      })}
    </WidgetList>
  </WidgetBody>;
}

registerWidget<RadarrConfig, RadarrQueueItem[]>({
  id: "radarr-queue",
  name: "Radarr Queue",
  preferredSize: "tall",
  compactHeader: true,
  sharedUI: true,
  sharedStateClassNames: {
    wrapper: "radarr-queue-widget radarr-queue-widget--empty",
    loading: "radarr-queue-widget__hint",
    error: "radarr-queue-widget__hint radarr-queue-widget__hint--error",
  },
  supportedFootprints: [{ label: "Default", columnSpan: 3, rowSpan: 4 }],
  minSize: "tall",
  serviceEditorPreset: {
    defaultName: "Radarr",
    defaultIconUrl: "https://cdn.simpleicons.org/radarr/ffc230",
  },
  configSchema: RadarrConfigSchema,
  fetchData: fetchQueue,
  refreshInterval: 15_000,
  component: RadarrQueueWidget,
  credentialScopeFields: ["url"],
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
