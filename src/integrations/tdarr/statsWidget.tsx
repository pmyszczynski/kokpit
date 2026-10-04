import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { WidgetBody, WidgetStatGrid, WidgetStat, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import type { WidgetStatTone } from "@/widgets/ui";
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
  footprint,
}: WidgetProps<TdarrStats>) {
  if (!data) {
    return (
      <WidgetBody centered className="tdarr-stats-widget tdarr-stats-widget--empty">
        <WidgetState state={loading ? "loading" : error ? "error" : "empty"}>
          {!loading ? error : undefined}
        </WidgetState>
      </WidgetBody>
    );
  }

  const footprintName = `${footprint?.columnSpan ?? 6}x${footprint?.rowSpan ?? 2}`;
  const detailed = footprintName === "3x4";
  const stats = {
    transcodeQueue: { label: "Transcode Queue", value: data.transcodeQueue,
      tone: data.transcodeQueue > 0 ? "warning" : "neutral" },
    healthCheckQueue: { label: "Health Checks", value: data.healthCheckQueue,
      tone: data.healthCheckQueue > 0 ? "warning" : "neutral" },
    errored: { label: "Errored", value: data.errored,
      tone: data.errored > 0 ? "alert" : "neutral" },
    spaceSavedGb: { label: "Space Saved", value: formatBytes(data.spaceSavedGb * 1_000_000_000),
      tone: data.spaceSavedGb > 0 ? "positive" : "neutral" },
    activeWorkers: { label: "Workers", value: data.activeWorkers,
      tone: data.activeWorkers > 0 ? "positive" : "neutral" },
    fps: { label: "FPS", value: data.fps.toFixed(1),
      tone: data.fps > 0 ? "info" : "neutral" },
  } satisfies Record<string, { label: string; value: string | number; tone: WidgetStatTone }>;
  const fields: (keyof typeof stats)[] = detailed
    ? ["transcodeQueue", "healthCheckQueue", "errored", "spaceSavedGb", "activeWorkers", "fps"]
    : footprintName === "6x2"
      ? ["transcodeQueue", "activeWorkers", "spaceSavedGb"]
      : ["transcodeQueue", "activeWorkers"];

  return (
    <WidgetBody
      className="tdarr-stats-widget"
      data-footprint={footprintName}
      aria-label="Tdarr stats"
      reserveNotice
      notice={<WidgetStaleNotice error={error} className="tdarr-stats-widget__stale-error" />}
    >
      <WidgetStatGrid columns={footprintName === "6x2" ? 3 : 2} className="tdarr-stats-widget__grid">
        {fields.map((key) => (
          <WidgetStat
            key={key}
            label={stats[key].label}
            value={stats[key].value}
            tone={stats[key].tone}
            className={`tdarr-stats-widget__stat tdarr-stats-widget__stat--${key}`}
            valueClassName="tdarr-stats-widget__value"
            labelClassName="tdarr-stats-widget__label"
          />
        ))}
      </WidgetStatGrid>
    </WidgetBody>
  );
}

registerWidget<TdarrConfig, TdarrStats>({
  id: "tdarr-stats",
  name: "Tdarr Stats",
  preferredSize: "normal",
  compactHeader: true,
  sharedUI: true,
  supportedFootprints: [
    { label: "Compact", columnSpan: 3, rowSpan: 2 },
    { label: "Detailed", columnSpan: 3, rowSpan: 4 },
    { label: "Wide", columnSpan: 6, rowSpan: 2 },
  ],
  serviceEditorPreset: {
    defaultName: "Tdarr",
    defaultIconUrl: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/tdarr.svg",
  },
  configSchema: TdarrConfigSchema,
  fetchData: fetchTdarrStats,
  refreshInterval: 10_000,
  component: TdarrStatsWidget,
  credentialScopeFields: ["url"],
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
