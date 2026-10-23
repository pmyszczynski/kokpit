import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { WidgetBody, WidgetStatGrid, WidgetStat, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import type { WidgetStatTone } from "@/widgets/ui";
import { fetchTdarrStats, TdarrConfigSchema } from "./api";
import type { TdarrConfig, TdarrStats } from "./api";
import { tdarrSetupGuide } from "./setupGuide";

// Space saved is a storage metric that commonly reaches TB on a busy Tdarr
// install, so we use a TB-aware decimal formatter (matching the Immich stats
// widget) rather than qBittorrent's GB-capped download formatter.
function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? "-" : "";
  const magnitude = Math.abs(bytes);
  if (magnitude >= 1_000_000_000_000) {
    return `${sign}${(magnitude / 1_000_000_000_000).toFixed(1)} TB`;
  }
  if (magnitude >= 1_000_000_000) {
    return `${sign}${(magnitude / 1_000_000_000).toFixed(1)} GB`;
  }
  if (magnitude >= 1_000_000) {
    return `${sign}${(magnitude / 1_000_000).toFixed(1)} MB`;
  }
  if (magnitude >= 1_000) {
    return `${sign}${(magnitude / 1_000).toFixed(1)} KB`;
  }
  return `${sign}${magnitude} B`;
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
  footprintDescription: "Compact (3×2) shows Transcode Queue and Workers. Wide (6×2) also shows Space Saved. Detailed (3×4) shows those three plus Health Checks, Errored and FPS. Missing counters or unavailable node data can appear as zero.",
  serviceEditorPreset: {
    defaultName: "Tdarr",
    defaultIconUrl: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/tdarr.svg",
  },
  configSchema: TdarrConfigSchema,
  fetchData: fetchTdarrStats,
  refreshInterval: 10_000,
  component: TdarrStatsWidget,
  credentialScopeFields: ["url"],
  setupGuide: tdarrSetupGuide,
  configFields: [
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:8266",
      description: "Tdarr Server’s API base address, including http:// or https:// and the Server port (normally 8266). The WebUI normally uses 8265 and belongs in the optional tile URL. Keep any proxy prefix; Kokpit appends /api/v2 routes. The API address must work from Kokpit.",
    },
    {
      key: "apikey",
      label: "API Key (optional)",
      type: "password",
      required: false,
      description: "Required when Tdarr Server authentication is enabled, including new v3 installs. Create it under Tools → API Keys and paste only its full value. Blank is for an already unauthenticated Server; an existing saved key is retained until you replace it or use Clear saved credential.",
    },
  ],
});
