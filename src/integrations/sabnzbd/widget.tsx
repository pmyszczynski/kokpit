import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { WidgetBody, WidgetStatGrid, WidgetStat, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import type { WidgetStatTone } from "@/widgets/ui";
import { fetchQueueData, SabnzbdConfigSchema } from "./api";
import type { SabnzbdConfig, SabnzbdQueueData } from "./api";

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1_000_000) {
    return `${(bytesPerSec / 1_000_000).toFixed(1)} MB/s`;
  }
  return `${(bytesPerSec / 1_000).toFixed(1)} KB/s`;
}

function formatSize(mb: number): string {
  if (mb >= 1_000) {
    return `${(mb / 1_000).toFixed(1)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

function statusTone(status: string | null | undefined): WidgetStatTone {
  switch (status?.toLowerCase()) {
    case "downloading":
    case "checking":
    case "repairing":
    case "extracting":
    case "moving":
    case "fetching": return "positive";
    case "paused":
    case "idle":
    case "stopped": return "neutral";
    case "queued": return "warning";
    case "error":
    case "failed": return "alert";
    default: return status ? "info" : "neutral";
  }
}

export function SabnzbdWidget({
  data,
  loading,
  error,
  refresh: _refresh,
  footprint,
}: WidgetProps<SabnzbdQueueData>) {
  if (!data) {
    return (
      <WidgetBody centered className="sabnzbd-widget sabnzbd-widget--empty">
        <WidgetState state={loading ? "loading" : error ? "error" : "empty"}>
          {!loading ? error : undefined}
        </WidgetState>
      </WidgetBody>
    );
  }

  // Direct legacy renders retain their original wide set of metrics.
  const footprintName = `${footprint?.columnSpan ?? 6}x${footprint?.rowSpan ?? 2}`;
  const detailed = footprintName === "3x4";
  const showSize = footprintName !== "3x2";

  return (
    <WidgetBody
      className="sabnzbd-widget"
      data-footprint={footprintName}
      aria-label="SABnzbd stats"
      reserveNotice
      notice={<WidgetStaleNotice error={error} className="sabnzbd-widget__stale-error" />}
    >
      <WidgetStatGrid columns={footprintName === "6x2" ? 3 : 2} className="sabnzbd-widget__grid">
        <WidgetStat
          label="↓ Speed"
          value={formatSpeed(data.speedBytesPerSec)}
          tone="positive"
          className="sabnzbd-widget__stat"
          valueClassName="sabnzbd-widget__value"
          labelClassName="sabnzbd-widget__label"
        />
        <WidgetStat
          label="Queue"
          value={data.queueCount}
          tone={data.queueCount > 0 ? "warning" : "neutral"}
          className="sabnzbd-widget__stat"
          valueClassName="sabnzbd-widget__value"
          labelClassName="sabnzbd-widget__label"
        />
        {showSize && <WidgetStat
          label="Queue Size"
          value={formatSize(data.totalMb)}
          tone="info"
          className="sabnzbd-widget__stat sabnzbd-widget__stat--wide"
          valueClassName="sabnzbd-widget__value"
          labelClassName="sabnzbd-widget__label"
        />}
        {detailed && <WidgetStat
          label="Remaining"
          value={data.remainingMb == null ? "—" : formatSize(data.remainingMb)}
          tone={data.remainingMb == null ? "neutral" : "info"}
          className="sabnzbd-widget__stat"
          valueClassName="sabnzbd-widget__value"
          labelClassName="sabnzbd-widget__label"
        />}
        {detailed && <WidgetStat
          label="ETA"
          value={data.queueCount > 0 ? data.timeLeft ?? "—" : "—"}
          tone={data.queueCount > 0 && data.timeLeft ? "info" : "neutral"}
          className="sabnzbd-widget__stat"
          valueClassName="sabnzbd-widget__value"
          labelClassName="sabnzbd-widget__label"
        />}
        {detailed && <WidgetStat
          label="Status"
          value={data.status ?? "—"}
          tone={statusTone(data.status)}
          className="sabnzbd-widget__stat"
          valueClassName="sabnzbd-widget__value"
          labelClassName="sabnzbd-widget__label"
        />}
      </WidgetStatGrid>
    </WidgetBody>
  );
}

registerWidget<SabnzbdConfig, SabnzbdQueueData>({
  id: "sabnzbd",
  name: "SABnzbd",
  preferredSize: "normal",
  compactHeader: true,
  sharedUI: true,
  supportedFootprints: [
    { label: "Compact", columnSpan: 3, rowSpan: 2 },
    { label: "Detailed", columnSpan: 3, rowSpan: 4 },
    { label: "Wide", columnSpan: 6, rowSpan: 2 },
  ],
  serviceEditorPreset: {
    defaultName: "SABnzbd",
    defaultIconUrl: "https://cdn.simpleicons.org/sabnzbd",
  },
  configSchema: SabnzbdConfigSchema,
  fetchData: fetchQueueData,
  refreshInterval: 10_000,
  component: SabnzbdWidget,
  credentialScopeFields: ["url"],
  configFields: [
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:8080",
    },
    {
      key: "apikey",
      label: "API Key",
      type: "password",
      required: true,
    },
  ],
});
