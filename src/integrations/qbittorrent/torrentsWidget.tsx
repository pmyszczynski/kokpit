import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchTorrents } from "./api";
import { QbittorrentConfigSchema } from "./api";
import type { QbittorrentConfig, Torrent } from "./api";
import { formatSpeed } from "./formatters";

export { formatSpeed } from "./formatters";

export function QbittorrentTorrentsWidget({
  data,
  loading,
  error,
  refresh: _refresh,
}: WidgetProps<Torrent[]>) {
  if (!data) {
    return (
      <div className="qbt-torrents-widget qbt-torrents-widget--empty">
        {loading && (
          <span className="qbt-torrents-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="qbt-torrents-widget__hint qbt-torrents-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="qbt-torrents-widget qbt-torrents-widget--empty">
        <span className="qbt-torrents-widget__hint">No torrents</span>
        {error && (
          <span className="qbt-torrents-widget__stale-error" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="qbt-torrents-widget" aria-label="qBittorrent torrents">
      <div className="qbt-torrents-widget__header">
        <span>Name</span>
        <span>Progress</span>
        <span>↓ Speed</span>
        <span>↑ Speed</span>
      </div>
      <div className="qbt-torrents-widget__list">
        {data.map((torrent) => {
          const pct = Math.round(torrent.progress * 100);
          return (
            <div key={torrent.hash} className="qbt-torrents-widget__row">
              <span className="qbt-torrents-widget__name" title={torrent.name}>
                {torrent.name}
              </span>
              <div className="qbt-torrents-widget__progress-cell">
                <div className="qbt-torrents-widget__progress-bar">
                  <div
                    className="qbt-torrents-widget__progress-fill"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="qbt-torrents-widget__progress-text">{pct}%</span>
              </div>
              <span
                className={`qbt-torrents-widget__speed${torrent.dlspeed > 0 ? " qbt-torrents-widget__speed--active" : ""}`}
              >
                {formatSpeed(torrent.dlspeed)}
              </span>
              <span
                className={`qbt-torrents-widget__speed${torrent.upspeed > 0 ? " qbt-torrents-widget__speed--active" : ""}`}
              >
                {formatSpeed(torrent.upspeed)}
              </span>
            </div>
          );
        })}
      </div>
      {error && (
        <span className="qbt-torrents-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<QbittorrentConfig, Torrent[]>({
  id: "qbittorrent-torrents",
  name: "qBittorrent Torrents",
  serviceEditorPreset: {
    defaultName: "qBittorrent",
    defaultIconUrl: "https://cdn.simpleicons.org/qbittorrent/2f67b2",
  },
  configSchema: QbittorrentConfigSchema,
  fetchData: fetchTorrents,
  refreshInterval: 30_000,
  component: QbittorrentTorrentsWidget,
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
