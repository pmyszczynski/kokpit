import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { WidgetBody, WidgetStatGrid, WidgetStat, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
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
      <WidgetBody centered className="immich-stats-widget immich-stats-widget--empty">
        <WidgetState state={loading ? "loading" : error ? "error" : "empty"}>
          {!loading ? error : undefined}
        </WidgetState>
      </WidgetBody>
    );
  }

  return (
    <WidgetBody
      className="immich-stats-widget"
      aria-label="Immich stats"
      reserveNotice
      noticeClassName="immich-stats-widget__notice"
      notice={<WidgetStaleNotice error={error} className="immich-stats-widget__stale-error" />}
    >
      <WidgetStatGrid columns={2} className="immich-stats-widget__grid">
        <WidgetStat
          label="Storage"
          value={formatBytes(data.usage)}
          className="immich-stats-widget__stat immich-stats-widget__stat--usage"
          valueClassName="immich-stats-widget__value"
          labelClassName="immich-stats-widget__label"
        />
        <WidgetStat
          label="Items"
          value={(data.photos + data.videos).toLocaleString()}
          tone="info"
          className="immich-stats-widget__stat immich-stats-widget__stat--items"
          valueClassName="immich-stats-widget__value"
          labelClassName="immich-stats-widget__label"
        />
      </WidgetStatGrid>
    </WidgetBody>
  );
}

registerWidget<ImmichConfig, ImmichStats>({
  id: "immich-stats",
  name: "Immich Stats",
  preferredSize: "normal",
  compactHeader: true,
  sharedUI: true,
  supportedFootprints: [
    { label: "Default", columnSpan: 3, rowSpan: 2 },
  ],
  configSchema: ImmichConfigSchema,
  fetchData: fetchStats,
  refreshInterval: 60_000,
  component: ImmichStatsWidget,
  credentialScopeFields: ["url"],
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
