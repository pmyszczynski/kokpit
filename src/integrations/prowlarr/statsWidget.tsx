import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { WidgetBody, WidgetStatGrid, WidgetStat, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import { fetchStats, ProwlarrConfigSchema } from "./api";
import type { ProwlarrConfig, ProwlarrStats } from "./api";

export function ProwlarrStatsWidget({
  data,
  loading,
  error,
  refresh: _refresh,
}: WidgetProps<ProwlarrStats>) {
  if (!data) {
    return (
      <WidgetBody centered className="prowlarr-stats-widget prowlarr-stats-widget--empty">
        <WidgetState state={loading ? "loading" : error ? "error" : "empty"}>
          {!loading ? error : undefined}
        </WidgetState>
      </WidgetBody>
    );
  }

  return (
    <WidgetBody
      className="prowlarr-stats-widget"
      aria-label="Prowlarr stats"
      reserveNotice
      notice={<WidgetStaleNotice error={error} className="prowlarr-stats-widget__stale-error" />}
    >
      <WidgetStatGrid columns={2} className="prowlarr-stats-widget__grid">
        <WidgetStat
          label="Enabled"
          value={data.enabledIndexers}
          className="prowlarr-stats-widget__stat"
          valueClassName="prowlarr-stats-widget__value"
          labelClassName="prowlarr-stats-widget__label"
        />
        <WidgetStat
          label="Failing"
          value={data.failingIndexers}
          tone={data.failingIndexers > 0 ? "alert" : "neutral"}
          className="prowlarr-stats-widget__stat"
          valueClassName={`prowlarr-stats-widget__value${data.failingIndexers > 0 ? " prowlarr-stats-widget__value--alert" : ""}`}
          labelClassName="prowlarr-stats-widget__label"
        />
        <WidgetStat
          label="Indexers"
          value={data.totalIndexers}
          className="prowlarr-stats-widget__stat"
          valueClassName="prowlarr-stats-widget__value"
          labelClassName="prowlarr-stats-widget__label"
        />
        <WidgetStat
          label="Total Grabs"
          value={data.totalGrabs.toLocaleString()}
          className="prowlarr-stats-widget__stat"
          valueClassName="prowlarr-stats-widget__value"
          labelClassName="prowlarr-stats-widget__label"
        />
        <WidgetStat
          label="Usenet"
          value={data.usenetIndexers}
          className="prowlarr-stats-widget__stat"
          valueClassName="prowlarr-stats-widget__value"
          labelClassName="prowlarr-stats-widget__label"
        />
        <WidgetStat
          label="Torrent"
          value={data.torrentIndexers}
          className="prowlarr-stats-widget__stat"
          valueClassName="prowlarr-stats-widget__value"
          labelClassName="prowlarr-stats-widget__label"
        />
      </WidgetStatGrid>
    </WidgetBody>
  );
}

registerWidget<ProwlarrConfig, ProwlarrStats>({
  id: "prowlarr-stats",
  name: "Prowlarr Stats",
  preferredSize: "tall",
  compactHeader: true,
  sharedUI: true,
  supportedFootprints: [{ label: "Default", columnSpan: 3, rowSpan: 4 }],
  serviceEditorPreset: {
    defaultName: "Prowlarr",
    defaultIconUrl: "https://cdn.simpleicons.org/prowlarr",
  },
  configSchema: ProwlarrConfigSchema,
  fetchData: fetchStats,
  refreshInterval: 60_000,
  component: ProwlarrStatsWidget,
  credentialScopeFields: ["url"],
  configFields: [
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:9696",
    },
    {
      key: "api_key",
      label: "API Key",
      type: "password",
      required: true,
    },
  ],
});
