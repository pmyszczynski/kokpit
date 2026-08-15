import { registerWidget } from "@/widgets";
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

export function TautulliActivityWidget({
  data,
  loading,
  error,
}: WidgetProps<TautulliActivityData>): React.ReactElement {
  if (!data) {
    return (
      <div className="tautulli-activity-widget tautulli-activity-widget--empty">
        {loading && <span className="tautulli-activity-widget__hint">Loading&hellip;</span>}
        {error && (
          <span className="tautulli-activity-widget__hint tautulli-activity-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="tautulli-activity-widget" aria-label="Tautulli activity">
      {data.summary && (
        <div className="tautulli-activity-widget__summary" aria-label="Tautulli summary">
          {[
            { label: "Active", value: String(data.summary.streamCount) },
            { label: "Direct Play", value: String(data.summary.directPlayCount) },
            { label: "Direct Stream", value: String(data.summary.directStreamCount) },
            { label: "Transcoding", value: String(data.summary.transcodeCount) },
            {
              label: "Bandwidth",
              value: formatBandwidth(data.summary.totalBandwidthKbps),
              modifier: "tautulli-activity-widget__stat--bandwidth",
            },
          ].map(({ label, value, modifier }) => (
            <div
              className={`tautulli-activity-widget__stat${modifier ? ` ${modifier}` : ""}`}
              key={label}
            >
              <span className="tautulli-activity-widget__value">{value}</span>
              <span className="tautulli-activity-widget__label">{label}</span>
            </div>
          ))}
        </div>
      )}
      {data.sessions && (
        <div className="tautulli-activity-widget__sessions" aria-label="Active Tautulli sessions">
          {data.sessions.length === 0
            ? <span className="tautulli-activity-widget__no-sessions">No active streams</span>
            : data.sessions.map((session, index) => {
                const progress = Math.round(
                  Math.min(100, Math.max(0, session.progressPercent))
                );
                return (
                  <div
                    className="tautulli-activity-widget__session"
                    key={`${session.username}:${session.title}:${index}`}
                  >
                    <div className="tautulli-activity-widget__session-heading">
                      <span className="tautulli-activity-widget__username">{session.username}</span>
                      <span>{formatLabel(session.state)}</span>
                    </div>
                    <div className="tautulli-activity-widget__session-media">
                      <span className="tautulli-activity-widget__title">{session.title}</span>
                      <span>{formatLabel(session.mediaType)} · {formatLabel(session.transcodeDecision)}</span>
                    </div>
                    <div
                      className="tautulli-activity-widget__progress"
                      role="progressbar"
                      aria-label={`${session.username} progress`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress}
                    >
                      <span style={{ width: `${progress}%` }} />
                    </div>
                    <span className="tautulli-activity-widget__progress-label">{progress}%</span>
                  </div>
                );
              })}
        </div>
      )}
      {error && <span className="tautulli-activity-widget__stale-error" role="alert">{error}</span>}
    </div>
  );
}

registerWidget<TautulliConfig, TautulliActivityData>({
  id: "tautulli-activity",
  name: "Tautulli Activity",
  configSchema: TautulliConfigSchema,
  fetchData: fetchActivity,
  refreshInterval: 10_000,
  preferredSize: "tall",
  supportedFootprints: [{ label: "Default", columnSpan: 3, rowSpan: 4 }],
  minSize: "tall",
  component: TautulliActivityWidget,
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
