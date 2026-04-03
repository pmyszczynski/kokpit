import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchTransferInfo } from "./api";
import { QbittorrentConfigSchema } from "./api";
import type { QbittorrentConfig, TransferInfo } from "./api";
import { formatSpeed, formatBytes } from "./formatters";

export { formatSpeed, formatBytes } from "./formatters";

export function QbittorrentStatsWidget({
  data,
  loading,
  error,
  refresh: _refresh,
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
      <div className="qbt-stats-widget__stat">
        <span className="qbt-stats-widget__value">{formatSpeed(data.dl_info_speed)}</span>
        <span className="qbt-stats-widget__label">↓ Speed</span>
      </div>
      <div className="qbt-stats-widget__stat">
        <span className="qbt-stats-widget__value">{formatSpeed(data.up_info_speed)}</span>
        <span className="qbt-stats-widget__label">↑ Speed</span>
      </div>
      <div className="qbt-stats-widget__stat">
        <span className="qbt-stats-widget__value">{formatBytes(data.dl_info_data)}</span>
        <span className="qbt-stats-widget__label">↓ Total</span>
      </div>
      <div className="qbt-stats-widget__stat">
        <span className="qbt-stats-widget__value">{formatBytes(data.up_info_data)}</span>
        <span className="qbt-stats-widget__label">↑ Total</span>
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
