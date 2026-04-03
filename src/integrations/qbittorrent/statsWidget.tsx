import { z } from "zod";
import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchTransferInfo } from "./api";
import type { QbittorrentConfig, TransferInfo } from "./api";

const QbittorrentConfigSchema = z.object({
  url: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
});

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1_000_000) {
    return `${(bytesPerSec / 1_000_000).toFixed(1)} MB/s`;
  }
  return `${(bytesPerSec / 1_000).toFixed(1)} KB/s`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  }
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function QbittorrentStatsWidget({
  data,
  loading,
  error,
}: WidgetProps<TransferInfo>) {
  if (!data) {
    return (
      <div className="qbt-stats-widget qbt-stats-widget--empty">
        {loading && (
          <span className="qbt-stats-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="qbt-stats-widget__hint qbt-stats-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="qbt-stats-widget" aria-label="qBittorrent stats">
      <div className="qbt-stats-widget__row">
        <span className="qbt-stats-widget__stat">
          ↓ {formatSpeed(data.dl_info_speed)}
        </span>
        <span className="qbt-stats-widget__stat">
          ↑ {formatSpeed(data.up_info_speed)}
        </span>
      </div>
      <div className="qbt-stats-widget__row">
        <span className="qbt-stats-widget__stat">
          ↓ total {formatBytes(data.dl_info_data)}
        </span>
        <span className="qbt-stats-widget__stat">
          ↑ total {formatBytes(data.up_info_data)}
        </span>
      </div>
      {error && (
        <span className="qbt-stats-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<QbittorrentConfig, TransferInfo>({
  id: "qbittorrent-stats",
  name: "qBittorrent Stats",
  configSchema: QbittorrentConfigSchema,
  fetchData: fetchTransferInfo,
  refreshInterval: 10_000,
  component: QbittorrentStatsWidget,
  configFields: [
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:8080",
    },
    {
      key: "username",
      label: "Username",
      type: "text",
      required: true,
      placeholder: "admin",
    },
    { key: "password", label: "Password", type: "password", required: true },
  ],
});
