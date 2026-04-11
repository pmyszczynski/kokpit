import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchStats, UnraidConfigSchema } from "./api";
import type { UnraidConfig, UnraidStats } from "./api";

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
  return `${(bytes / 1_000).toFixed(1)} KB`;
}

function formatArrayState(state: string): string {
  return state
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatParityStatus(status: string): string {
  if (status === "") return "OK";
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function UnraidStatsWidget({
  data,
  loading,
  error,
}: WidgetProps<UnraidStats>) {
  if (!data) {
    return (
      <div className="unraid-stats-widget unraid-stats-widget--empty">
        {loading && (
          <span className="unraid-stats-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="unraid-stats-widget__hint unraid-stats-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  const usedPct =
    data.totalBytes > 0
      ? Math.round((data.usedBytes / data.totalBytes) * 100)
      : 0;

  return (
    <div className="unraid-stats-widget" aria-label="Unraid stats">
      <div className="unraid-stats-widget__stat unraid-stats-widget__stat--state">
        <span className="unraid-stats-widget__value">
          {formatArrayState(data.arrayState)}
        </span>
        <span className="unraid-stats-widget__label">Array</span>
      </div>
      <div className="unraid-stats-widget__stat">
        <span className="unraid-stats-widget__value">
          {formatBytes(data.usedBytes)}
          <span className="unraid-stats-widget__sub">
            {" / "}
            {formatBytes(data.totalBytes)}
          </span>
        </span>
        <span className="unraid-stats-widget__label">Used ({usedPct}%)</span>
      </div>
      <div className="unraid-stats-widget__stat">
        <span className="unraid-stats-widget__value">{data.diskCount}</span>
        <span className="unraid-stats-widget__label">Disks</span>
      </div>
      <div className="unraid-stats-widget__stat">
        <span
          className={`unraid-stats-widget__value${data.diskErrors > 0 ? " unraid-stats-widget__value--error" : ""}`}
        >
          {data.diskErrors}
        </span>
        <span className="unraid-stats-widget__label">Errors</span>
      </div>
      {data.parityStatus !== null && (
        <div className="unraid-stats-widget__stat unraid-stats-widget__stat--wide">
          <span className="unraid-stats-widget__value">
            {formatParityStatus(data.parityStatus)}
            {data.parityErrors !== null && data.parityErrors > 0 && (
              <span className="unraid-stats-widget__value--error">
                {" "}({data.parityErrors} err)
              </span>
            )}
          </span>
          <span className="unraid-stats-widget__label">
            Parity
            {data.parityDate ? ` · ${data.parityDate}` : ""}
          </span>
        </div>
      )}
      {error && (
        <span className="unraid-stats-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<UnraidConfig, UnraidStats>({
  id: "unraid-stats",
  name: "Unraid Stats",
  serviceEditorPreset: {
    defaultName: "Unraid",
    defaultIconUrl: "https://cdn.simpleicons.org/unraid",
  },
  configSchema: UnraidConfigSchema,
  fetchData: fetchStats,
  refreshInterval: 30_000,
  component: UnraidStatsWidget,
  configFields: [
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x",
    },
    {
      key: "api_key",
      label: "API Key",
      type: "password",
      required: true,
      description:
        "Create an API key in Settings > Management Access > API Keys",
    },
  ],
});
