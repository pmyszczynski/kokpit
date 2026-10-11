import { registerWidget } from "@/widgets";
import { WidgetBody, WidgetStatGrid, WidgetStat, WidgetList, WidgetListItem, WidgetBadge, WidgetBar, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import type { WidgetBadgeTone } from "@/widgets/ui";
import type { WidgetConfigField, WidgetProps } from "@/widgets";
import {
  fetchActivity,
  TautulliConfigSchema,
} from "./api";
import type { TautulliActivityData, TautulliConfig } from "./api";

const TAUTULLI_SECTIONS_FIELD = {
  key: "sections",
  label: "Display sections",
  type: "multiselect",
  required: true,
  defaultValue: ["summary", "sessions"],
  options: [
    { value: "summary", label: "Summary" },
    { value: "sessions", label: "Active sessions" },
  ],
  description: "Select at least one section.",
} satisfies WidgetConfigField;

function formatLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatBandwidth(kbps: number): string {
  if (kbps >= 1_000_000) return `${(kbps / 1_000_000).toFixed(1)} Gbps`;
  if (kbps >= 1_000) return `${(kbps / 1_000).toFixed(1)} Mbps`;
  return `${kbps.toFixed(0)} Kbps`;
}

function playbackTone(state: string): WidgetBadgeTone {
  switch (state.toLowerCase()) {
    case "playing": return "positive";
    case "buffering": return "warning";
    case "error": case "failed": return "alert";
    case "paused": case "stopped": case "unknown": return "neutral";
    default: return "info";
  }
}

export function TautulliActivityWidget({ data, loading, error, footprint }: WidgetProps<TautulliActivityData>): React.ReactElement {
  if (!data) return <WidgetBody centered className="tautulli-activity-widget tautulli-activity-widget--empty">
    <WidgetState state={loading ? "loading" : error ? "error" : "empty"}
      className={loading ? "tautulli-activity-widget__hint" : undefined} labelClassName="tautulli-activity-widget__hint tautulli-activity-widget__hint--error">{!loading ? error : undefined}</WidgetState>
  </WidgetBody>;
  const expanded = footprint?.columnSpan === 6;
  const summary = data.summary && <WidgetStatGrid columns={expanded ? 5 : 3} className="tautulli-activity-widget__summary" aria-label="Tautulli summary">
    {[
      { label: "Active", value: String(data.summary.streamCount), count: data.summary.streamCount },
      { label: "Direct Play", value: String(data.summary.directPlayCount), count: data.summary.directPlayCount },
      { label: "Direct Stream", value: String(data.summary.directStreamCount), count: data.summary.directStreamCount },
      { label: "Transcoding", value: String(data.summary.transcodeCount), count: data.summary.transcodeCount },
      { label: "Bandwidth", value: formatBandwidth(data.summary.totalBandwidthKbps), count: null },
    ].map(({ label, value, count }) => <WidgetStat key={label} label={label} value={value}
      tone={count === null ? "info" : count > 0 ? "positive" : "neutral"}
      className={`tautulli-activity-widget__stat${count === null ? " tautulli-activity-widget__stat--bandwidth" : ""}`}
      valueClassName="tautulli-activity-widget__value" labelClassName="tautulli-activity-widget__label" />)}
  </WidgetStatGrid>;
  return <WidgetBody className="tautulli-activity-widget" aria-label="Tautulli activity" data-footprint={expanded ? "6x4" : "3x4"}
    reserveNotice notice={<WidgetStaleNotice error={error} className="tautulli-activity-widget__stale-error" />}>
    {data.sessions ? <WidgetList label="Active Tautulli sessions" listClassName="tautulli-activity-widget__sessions" header={summary}
      empty={data.sessions.length === 0 ? <WidgetState state="empty" className="tautulli-activity-widget__no-sessions">No active streams</WidgetState> : undefined}>
      {data.sessions.map((session, index) => {
        const progress = Math.round(Math.min(100, Math.max(0, session.progressPercent)));
        const metadata = `${formatLabel(session.mediaType)} · ${formatLabel(session.transcodeDecision)}`;
        const tone = playbackTone(session.state);
        return <WidgetListItem key={`${session.username}:${session.title}:${index}`} className="tautulli-activity-widget__session"
          title={session.title} titleClassName="tautulli-activity-widget__title" contentClassName="tautulli-activity-widget__session-media"
          secondary={<><span className="tautulli-activity-widget__username">{session.username}</span> · <span>{metadata}</span></>}
          secondaryTooltip={`${session.username} · ${metadata}`}
          trailing={<WidgetBadge tone={tone} className="tautulli-activity-widget__session-heading">{formatLabel(session.state)}</WidgetBadge>}
          wrapTrailing footer={<WidgetBar label={`${session.username} progress`} value={progress} tone={tone} valueLabel={`${progress}%`}
            trackClassName="tautulli-activity-widget__progress" labelClassName="tautulli-activity-widget__progress-label" />} />;
      })}
    </WidgetList> : summary ?? <WidgetState state="empty">No activity sections</WidgetState>}
  </WidgetBody>;
}

registerWidget<TautulliConfig, TautulliActivityData>({
  id: "tautulli-activity",
  name: "Tautulli Activity",
  configSchema: TautulliConfigSchema,
  fetchData: fetchActivity,
  refreshInterval: 10_000,
  preferredSize: "tall",
  supportedFootprints: [{ label: "Default", columnSpan: 3, rowSpan: 4 }, { label: "Expanded", columnSpan: 6, rowSpan: 4 }],
  minSize: "tall",
  component: TautulliActivityWidget,
  compactHeader: true,
  sharedUI: true,
  sharedStateClassNames: { wrapper: "tautulli-activity-widget tautulli-activity-widget--empty", loading: "tautulli-activity-widget__hint", error: "tautulli-activity-widget__hint tautulli-activity-widget__hint--error" },
  serviceEditorPreset: {
    defaultName: "Tautulli",
    defaultIconUrl:
      "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/svg/tautulli.svg",
  },
  credentialScopeFields: ["url"],
  optionFields: [TAUTULLI_SECTIONS_FIELD],
  configFields: [
    { key: "url", label: "URL", type: "url", required: true, placeholder: "http://192.168.1.x:8181" },
    { key: "api_key", label: "API Key", type: "password", required: true },
    TAUTULLI_SECTIONS_FIELD,
  ],
});
