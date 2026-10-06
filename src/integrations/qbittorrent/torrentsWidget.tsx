import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { fetchTorrents } from "./api";
import { QbittorrentConfigSchema } from "./api";
import type { QbittorrentConfig, Torrent } from "./api";
import { formatSpeed } from "./formatters";
import {
  WidgetBody, WidgetList, WidgetListItem, WidgetBar, WidgetState, WidgetStaleNotice,
} from "@/widgets/ui";

export { formatSpeed } from "./formatters";

export function QbittorrentTorrentsWidget({
  data,
  loading,
  error,
}: WidgetProps<Torrent[]>) {
  if (!data) {
    return (
      <WidgetBody centered className="qbt-torrents-widget qbt-torrents-widget--empty">
        <WidgetState
          state={loading ? "loading" : error ? "error" : "empty"}
          className="qbt-torrents-widget__hint"
          labelClassName="qbt-torrents-widget__hint qbt-torrents-widget__hint--error"
        >
          {loading ? "Loading…" : error}
        </WidgetState>
      </WidgetBody>
    );
  }

  return (
    <WidgetBody
      className={`qbt-torrents-widget${data.length === 0 ? " qbt-torrents-widget--empty" : ""}`}
      aria-label="qBittorrent torrents"
      reserveNotice
      notice={<WidgetStaleNotice error={error} className="qbt-torrents-widget__stale-error" />}
    >
      <WidgetList
        label="qBittorrent torrents"
        listClassName="qbt-torrents-widget__list"
        columnLabels={["Name", "Progress", "↓ Speed", "↑ Speed"]}
        columnsClassName="qbt-torrents-widget__header"
        empty={data.length === 0 ? <WidgetState state="empty" className="qbt-torrents-widget__hint">No torrents</WidgetState> : undefined}
      >
        {data.map(torrent => {
          const pct = Math.round(torrent.progress * 100);
          return (
            <WidgetListItem
              key={torrent.hash}
              className="qbt-torrents-widget__row"
              title={torrent.name}
              titleClassName="qbt-torrents-widget__name"
              columns={[
                { content: <WidgetBar
                  label={`Download progress for ${torrent.name}`}
                  value={pct}
                  valueLabel={`${pct}%`}
                  tone="positive"
                  className="qbt-torrents-widget__progress-cell"
                  trackClassName="qbt-torrents-widget__progress-bar"
                  fillClassName="qbt-torrents-widget__progress-fill"
                  labelClassName="qbt-torrents-widget__progress-text"
                /> },
                {
                  content: formatSpeed(torrent.dlspeed),
                  tone: torrent.dlspeed > 0 ? "positive" : "neutral",
                  className: `qbt-torrents-widget__speed${torrent.dlspeed > 0 ? " qbt-torrents-widget__speed--active" : ""}`,
                },
                {
                  content: formatSpeed(torrent.upspeed),
                  tone: torrent.upspeed > 0 ? "info" : "neutral",
                  className: `qbt-torrents-widget__speed${torrent.upspeed > 0 ? " qbt-torrents-widget__speed--active" : ""}`,
                },
              ]}
            />
          );
        })}
      </WidgetList>
    </WidgetBody>
  );
}

registerWidget<QbittorrentConfig, Torrent[]>({
  id: "qbittorrent-torrents",
  name: "qBittorrent Torrents",
  preferredSize: "tall",
  compactHeader: true,
  sharedUI: true,
  sharedStateClassNames: {
    wrapper: "qbt-torrents-widget qbt-torrents-widget--empty",
    loading: "qbt-torrents-widget__hint",
    error: "qbt-torrents-widget__hint qbt-torrents-widget__hint--error",
  },
  supportedFootprints: [{ label: "Default", columnSpan: 3, rowSpan: 4 }],
  minSize: "tall",
  serviceEditorPreset: {
    defaultName: "qBittorrent",
    defaultIconUrl: "https://cdn.simpleicons.org/qbittorrent/2f67b2",
  },
  configSchema: QbittorrentConfigSchema,
  fetchData: fetchTorrents,
  refreshInterval: 15_000,
  component: QbittorrentTorrentsWidget,
  credentialScopeFields: ["url", "username"],
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
