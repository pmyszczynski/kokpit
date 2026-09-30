import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { WidgetBody, WidgetStat, WidgetStatGrid, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import { fetchQbittorrentStats } from "./api";
import { QbittorrentConfigSchema } from "./api";
import type { QbittorrentConfig, QbittorrentStatsData } from "./api";
import { formatSpeed, formatBytes } from "./formatters";
import "./statsWidget.css";

export { formatSpeed, formatBytes } from "./formatters";

export function QbittorrentStatsWidget({
  data,
  loading,
  error,
  refresh: _refresh,
  footprint,
}: WidgetProps<QbittorrentStatsData>) {
  if (!data) {
    return (
      <WidgetBody centered className="qbt-stats-widget qbt-stats-widget--empty">
        <WidgetState state={loading ? "loading" : error ? "error" : "empty"}>
          {!loading ? error ?? "No transfer data available" : undefined}
        </WidgetState>
      </WidgetBody>
    );
  }

  const footprintName = `${footprint?.columnSpan ?? 6}x${footprint?.rowSpan ?? 2}`;
  const showTotals = footprintName !== "3x2";
  const showActivity = footprintName === "3x4";
  const activityUnavailable = showActivity && data.activity === null;
  const columns = footprintName === "6x2" ? 4 : 2;

  return (
    <WidgetBody
      className="qbt-stats-widget"
      data-footprint={footprintName}
      aria-label="qBittorrent stats"
      reserveNotice
      noticeClassName="qbt-stats-widget__notice"
      notice={error
        ? <WidgetStaleNotice error={error} className="qbt-stats-widget__stale-error" />
        : activityUnavailable
          ? <span className="qbt-stats-widget__activity-unavailable" role="status">Activity unavailable</span>
          : null}
    >
      <WidgetStatGrid
        columns={columns}
        className={`qbt-stats-widget__grid${showActivity ? " qbt-stats-widget__grid--with-activity" : ""}`}
      >
        <WidgetStat
          label="↓ Speed"
          value={formatSpeed(data.dl_info_speed)}
          className="qbt-stats-widget__stat"
          valueClassName="qbt-stats-widget__value"
          labelClassName="qbt-stats-widget__label"
        />
        <WidgetStat
          label="↑ Speed"
          value={formatSpeed(data.up_info_speed)}
          className="qbt-stats-widget__stat"
          valueClassName="qbt-stats-widget__value"
          labelClassName="qbt-stats-widget__label"
        />
        {showTotals && (
          <WidgetStat
            label="↓ Total"
            value={formatBytes(data.dl_info_data)}
            className="qbt-stats-widget__stat"
            valueClassName="qbt-stats-widget__value"
            labelClassName="qbt-stats-widget__label"
          />
        )}
        {showTotals && (
          <WidgetStat
            label="↑ Total"
            value={formatBytes(data.up_info_data)}
            className="qbt-stats-widget__stat"
            valueClassName="qbt-stats-widget__value"
            labelClassName="qbt-stats-widget__label"
          />
        )}
        {showActivity && (
          ([
            ["Downloading", data.activity?.downloading],
            ["Seeding", data.activity?.seeding],
            ["Stalled", data.activity?.stalled],
            ["Queued", data.activity?.queued],
          ] as const).map(([label, value]) => (
            <WidgetStat
              key={label}
              label={label}
              value={value ?? <span title="Activity unavailable">—</span>}
              className="qbt-stats-widget__activity-stat"
            />
          ))
        )}
      </WidgetStatGrid>
    </WidgetBody>
  );
}

registerWidget<QbittorrentConfig, QbittorrentStatsData>({
  id: "qbittorrent-stats",
  name: "qBittorrent Stats",
  preferredSize: "normal",
  compactHeader: true,
  sharedUI: true,
  supportedFootprints: [
    { label: "Compact speeds", columnSpan: 3, rowSpan: 2 },
    { label: "Detailed", columnSpan: 3, rowSpan: 4 },
    { label: "Wide", columnSpan: 6, rowSpan: 2 },
  ],
  serviceEditorPreset: {
    defaultName: "qBittorrent",
    defaultIconUrl: "https://cdn.simpleicons.org/qbittorrent/2f67b2",
  },
  configSchema: QbittorrentConfigSchema,
  fetchData: (config, signal, context) => fetchQbittorrentStats(
    config,
    signal,
    context?.footprint.columnSpan === 3 && context.footprint.rowSpan === 4
  ),
  refreshInterval: 10_000,
  component: QbittorrentStatsWidget,
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
