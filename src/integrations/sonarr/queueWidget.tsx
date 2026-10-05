import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchQueue, SonarrConfigSchema } from "./api";
import type { SonarrConfig, SonarrQueueItem } from "./api";
import { WidgetBody, WidgetList, WidgetListItem, WidgetBar, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import { calcProgress } from "@/integrations/shared/queue";

export function SonarrQueueWidget({ data, loading, error }: WidgetProps<SonarrQueueItem[]>) {
  if (!data) {
    return <WidgetBody centered className="sonarr-queue-widget sonarr-queue-widget--empty">
      <WidgetState state={loading ? "loading" : error ? "error" : "empty"}
        className={loading ? "sonarr-queue-widget__hint" : undefined}
        labelClassName="sonarr-queue-widget__hint sonarr-queue-widget__hint--error">{!loading ? error : undefined}</WidgetState>
    </WidgetBody>;
  }
  return <WidgetBody className={`sonarr-queue-widget${data.length === 0 ? " sonarr-queue-widget--empty" : ""}`}
    aria-label="Sonarr queue" reserveNotice
    notice={<WidgetStaleNotice error={error} className="sonarr-queue-widget__stale-error" />}>
    <WidgetList label="Sonarr queue" listClassName="sonarr-queue-widget__list"
      columnLabels={["Name", "Progress", "Status", "ETA"]} columnsClassName="sonarr-queue-widget__header"
      empty={data.length === 0 ? <WidgetState state="empty" className="sonarr-queue-widget__hint">Queue is empty</WidgetState> : undefined}>
      {data.map(item => {
        const pct = calcProgress(item.size, item.sizeleft);
        const tracked = item.trackedDownloadStatus?.toLowerCase();
        const tone = tracked === "warning" ? "warning" : tracked === "error" ? "alert" : "neutral";
        const statusClass = tracked && tracked !== "ok" ? ` sonarr-queue-widget__status--${tracked}` : "";
        return <WidgetListItem key={item.id} className="sonarr-queue-widget__row" title={item.title} titleTooltip={item.title}
          titleClassName="sonarr-queue-widget__name" columns={[
            { content: <WidgetBar label={`Download progress for ${item.title}`} value={pct} valueLabel={`${pct}%`} tone="positive"
              className="sonarr-queue-widget__progress-cell" trackClassName="sonarr-queue-widget__progress-bar"
              fillClassName="sonarr-queue-widget__progress-fill" labelClassName="sonarr-queue-widget__progress-text" /> },
            { content: item.status, tone, className: `sonarr-queue-widget__status${statusClass}` },
            { content: item.timeleft ?? "—", className: "sonarr-queue-widget__timeleft" },
          ]} />;
      })}
    </WidgetList>
  </WidgetBody>;
}

registerWidget<SonarrConfig, SonarrQueueItem[]>({
  id: "sonarr-queue",
  name: "Sonarr Queue",
  preferredSize: "tall",
  compactHeader: true,
  sharedUI: true,
  sharedStateClassNames: {
    wrapper: "sonarr-queue-widget sonarr-queue-widget--empty",
    loading: "sonarr-queue-widget__hint",
    error: "sonarr-queue-widget__hint sonarr-queue-widget__hint--error",
  },
  supportedFootprints: [{ label: "Default", columnSpan: 3, rowSpan: 4 }],
  minSize: "tall",
  serviceEditorPreset: {
    defaultName: "Sonarr",
    defaultIconUrl: "https://cdn.simpleicons.org/sonarr/35c5f4",
  },
  configSchema: SonarrConfigSchema,
  fetchData: fetchQueue,
  refreshInterval: 15_000,
  component: SonarrQueueWidget,
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
  ],
});
