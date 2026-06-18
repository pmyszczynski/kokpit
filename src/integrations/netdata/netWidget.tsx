import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import {
  NetdataBaseConfigSchema,
  fetchAllMetrics,
  fetchChartHistory,
  extractNet,
} from "./api";
import type { NetdataBaseConfig, RawChartHistory } from "./api";
import { Sparkline } from "./Sparkline";

interface NetData {
  inBps: number;
  outBps: number;
  inHistory: number[];
  outHistory: number[];
}

function fmtBps(bps: number): string {
  const abs = Math.abs(bps);
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)} MB/s`;
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)} KB/s`;
  return `${abs.toFixed(0)} B/s`;
}

async function fetchNetData(
  config: NetdataBaseConfig,
  signal?: AbortSignal
): Promise<NetData> {
  const [metrics, hist] = await Promise.all([
    fetchAllMetrics(config, signal),
    fetchChartHistory(config, "system.net", signal).catch(
      (): RawChartHistory => ({ dimensionNames: [], rows: [] })
    ),
  ]);
  const rxIdx = hist.dimensionNames.indexOf("received");
  const txIdx = hist.dimensionNames.indexOf("sent");
  // system.net is in kilobits/s; convert to bytes/s
  const toBytes = (kbps: number) => (Math.abs(kbps) * 1000) / 8;
  const inHistory =
    rxIdx >= 0 ? hist.rows.map((row) => toBytes(row[rxIdx] ?? 0)) : [];
  const outHistory =
    txIdx >= 0 ? hist.rows.map((row) => toBytes(row[txIdx] ?? 0)) : [];
  const { inBps, outBps } = extractNet(metrics);
  return { inBps, outBps, inHistory, outHistory };
}

export function NetdataNetWidget({
  data,
  loading,
  error,
}: WidgetProps<NetData>) {
  if (!data) {
    return (
      <div className="netdata-widget netdata-widget--empty">
        {loading && <span className="netdata-widget__hint">Loading&hellip;</span>}
        {error && (
          <span className="netdata-widget__hint netdata-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  const combined =
    data.inHistory.length >= 2
      ? data.inHistory.map((v, i) => v + (data.outHistory[i] ?? 0))
      : [];

  return (
    <div className="netdata-widget" aria-label="Network">
      <span className="netdata-widget__label">Network</span>
      {combined.length >= 2 && <Sparkline values={combined} />}
      <span className="netdata-widget__value">↓ {fmtBps(data.inBps)}</span>
      <span className="netdata-widget__subvalue">↑ {fmtBps(data.outBps)}</span>
      {error && (
        <span className="netdata-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<NetdataBaseConfig, NetData>({
  id: "netdata-net",
  name: "Netdata Network",
  configSchema: NetdataBaseConfigSchema,
  fetchData: fetchNetData,
  refreshInterval: 10_000,
  component: NetdataNetWidget,
  configFields: [
    {
      key: "url",
      label: "Netdata URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:19999",
    },
    { key: "api_token", label: "API Token", type: "password", required: false },
    {
      key: "history_minutes",
      label: "History (minutes)",
      type: "number",
      placeholder: "10",
      required: false,
    },
  ],
  serviceEditorPreset: {
    defaultName: "Network",
    defaultIconUrl: "https://cdn.simpleicons.org/netdata",
  },
});
