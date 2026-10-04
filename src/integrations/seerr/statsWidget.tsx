import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { WidgetBody, WidgetStatGrid, WidgetStat, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import type { WidgetStatTone } from "@/widgets/ui";
import { fetchStats, SeerrConfigSchema } from "./api";
import type { SeerrConfig, SeerrStats } from "./api";

export function SeerrStatsWidget({ data, loading, error, footprint }: WidgetProps<SeerrStats>) {
  if (!data) {
    return <WidgetBody centered className="seerr-stats-widget seerr-stats-widget--empty">
      <WidgetState className={loading ? "seerr-stats-widget__hint" : undefined} labelClassName="seerr-stats-widget__hint seerr-stats-widget__hint--error" state={loading ? "loading" : error ? "error" : "empty"}>{!loading ? error : undefined}</WidgetState>
    </WidgetBody>;
  }
  const footprintName = `${footprint?.columnSpan ?? 6}x${footprint?.rowSpan ?? 2}`;
  const fields: (keyof SeerrStats)[] = footprintName === "3x4"
    ? ["pending", "approved", "available", "total"]
    : footprintName === "6x2" ? ["pending", "available", "total"] : ["pending", "available"];
  const stats = {
    pending: { label: "Pending", tone: data.pending > 0 ? "warning" : "neutral" },
    approved: { label: "Approved", tone: "info" },
    available: { label: "Available", tone: data.available > 0 ? "positive" : "neutral" },
    total: { label: "Total", tone: "info" },
  } satisfies Record<keyof SeerrStats, { label: string; tone: WidgetStatTone }>;
  return <WidgetBody className="seerr-stats-widget" data-footprint={footprintName} aria-label="Seerr stats" reserveNotice
    notice={<WidgetStaleNotice error={error} className="seerr-stats-widget__stale-error" />}>
    <WidgetStatGrid columns={footprintName === "6x2" ? 3 : 2} className="seerr-stats-widget__grid">
      {fields.map(key => <WidgetStat key={key} label={stats[key].label} value={data[key]} tone={stats[key].tone}
        className={`seerr-stats-widget__stat seerr-stats-widget__stat--${key}`}
        valueClassName="seerr-stats-widget__value" labelClassName="seerr-stats-widget__label" />)}
    </WidgetStatGrid>
  </WidgetBody>;
}

registerWidget<SeerrConfig, SeerrStats>({
  id: "seerr-stats",
  name: "Seerr Stats",
  preferredSize: "normal",
  compactHeader: true,
  sharedUI: true,
  sharedStateClassNames: {
    wrapper: "seerr-stats-widget seerr-stats-widget--empty",
    loading: "seerr-stats-widget__hint",
    error: "seerr-stats-widget__hint seerr-stats-widget__hint--error",
  },
  supportedFootprints: [
    { label: "Compact", columnSpan: 3, rowSpan: 2 },
    { label: "Detailed", columnSpan: 3, rowSpan: 4 },
    { label: "Wide", columnSpan: 6, rowSpan: 2 },
  ],
  configSchema: SeerrConfigSchema,
  fetchData: fetchStats,
  refreshInterval: 60_000,
  component: SeerrStatsWidget,
  credentialScopeFields: ["url"],
  configFields: [
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:5055",
      description: "Works with Seerr, Jellyseerr, and Overseerr",
    },
    { key: "api_key", label: "API Key", type: "password", required: true },
  ],
  serviceEditorPreset: {
    defaultName: "Seerr",
    // Seerr brand color #615fff. Not yet on simpleicons (PR #14462 pending).
    defaultIconUrl:
      "https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons@main/svg/seerr.svg",
  },
});
