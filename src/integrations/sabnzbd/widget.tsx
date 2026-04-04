import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
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

export function SabnzbdWidget({
  data,
  loading,
  error,
  refresh: _refresh,
}: WidgetProps<SabnzbdQueueData>) {
  if (!data) {
    return (
      <div className="sabnzbd-widget sabnzbd-widget--empty">
        {loading && (
          <span className="sabnzbd-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="sabnzbd-widget__hint sabnzbd-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="sabnzbd-widget" aria-label="SABnzbd stats">
      <div className="sabnzbd-widget__stat">
        <span className="sabnzbd-widget__value">{formatSpeed(data.speedBytesPerSec)}</span>
        <span className="sabnzbd-widget__label">↓ Speed</span>
      </div>
      <div className="sabnzbd-widget__stat">
        <span className="sabnzbd-widget__value">{data.queueCount}</span>
        <span className="sabnzbd-widget__label">Queue</span>
      </div>
      <div className="sabnzbd-widget__stat sabnzbd-widget__stat--wide">
        <span className="sabnzbd-widget__value">{formatSize(data.totalMb)}</span>
        <span className="sabnzbd-widget__label">Queue Size</span>
      </div>
      {error && (
        <span className="sabnzbd-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<SabnzbdConfig, SabnzbdQueueData>({
  id: "sabnzbd",
  name: "SABnzbd",
  serviceEditorPreset: {
    defaultName: "SABnzbd",
    defaultIconUrl: "https://cdn.simpleicons.org/sabnzbd",
  },
  configSchema: SabnzbdConfigSchema,
  fetchData: fetchQueueData,
  refreshInterval: 10_000,
  component: SabnzbdWidget,
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
