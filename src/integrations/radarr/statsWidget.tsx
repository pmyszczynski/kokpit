import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { WidgetBody, WidgetStatGrid, WidgetStat, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import type { WidgetStatTone } from "@/widgets/ui";
import { fetchStats, RadarrConfigSchema } from "./api";
import type { RadarrConfig, RadarrStats } from "./api";

export function RadarrStatsWidget({
  data,
  loading,
  error,
  refresh: _refresh,
  footprint,
}: WidgetProps<RadarrStats>) {
  if (!data) {
    return (
      <WidgetBody centered className="radarr-stats-widget radarr-stats-widget--empty">
        <WidgetState state={loading ? "loading" : error ? "error" : "empty"}>
          {!loading ? error : undefined}
        </WidgetState>
      </WidgetBody>
    );
  }

  const wide = footprint?.columnSpan === 6 && footprint.rowSpan === 2;
  const stats: { key: keyof RadarrStats; label: string; tone: WidgetStatTone }[] = [
    { key: "missing", label: "Missing", tone: data.missing > 0 ? "alert" : "neutral" },
    { key: "upcoming", label: "Upcoming", tone: "info" },
    { key: "wanted", label: "Wanted", tone: data.wanted > 0 ? "warning" : "neutral" },
    { key: "queued", label: "Queued", tone: data.queued > 0 ? "warning" : "neutral" },
    { key: "available", label: "Available", tone: "positive" },
    { key: "total", label: "Total", tone: "info" },
  ];

  return (
    <WidgetBody
      className="radarr-stats-widget"
      data-footprint={wide ? "6x2" : "3x4"}
      aria-label="Radarr stats"
      reserveNotice
      notice={<WidgetStaleNotice error={error} className="radarr-stats-widget__stale-error" />}
    >
      <WidgetStatGrid columns={wide ? 6 : 2} className="radarr-stats-widget__grid">
        {stats.map(({ key, label, tone }) => (
          <WidgetStat
            key={key}
            label={label}
            value={data[key]}
            tone={tone}
            className={`radarr-stats-widget__stat radarr-stats-widget__stat--${key}`}
            valueClassName="radarr-stats-widget__value"
            labelClassName="radarr-stats-widget__label"
          />
        ))}
      </WidgetStatGrid>
    </WidgetBody>
  );
}

registerWidget<RadarrConfig, RadarrStats>({
  id: "radarr-stats",
  name: "Radarr Stats",
  preferredSize: "tall",
  compactHeader: true,
  sharedUI: true,
  supportedFootprints: [
    { label: "Detailed", columnSpan: 3, rowSpan: 4 },
    { label: "Wide", columnSpan: 6, rowSpan: 2 },
  ],
  serviceEditorPreset: {
    defaultName: "Radarr",
    defaultIconUrl: "https://cdn.simpleicons.org/radarr/ffc230",
  },
  configSchema: RadarrConfigSchema,
  fetchData: fetchStats,
  refreshInterval: 60_000,
  component: RadarrStatsWidget,
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
