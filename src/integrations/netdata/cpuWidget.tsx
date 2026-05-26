import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import {
  NetdataBaseConfigSchema,
  fetchAllMetrics,
  fetchChartHistory,
  extractCpu,
} from "./api";
import type { NetdataBaseConfig } from "./api";
import { Sparkline } from "./Sparkline";

interface CpuData {
  current: number;
  history: number[];
}

async function fetchCpuData(
  config: NetdataBaseConfig,
  signal?: AbortSignal
): Promise<CpuData> {
  const [metrics, hist] = await Promise.all([
    fetchAllMetrics(config, signal),
    fetchChartHistory(config, "system.cpu", signal).catch(() => ({
      dimensionNames: [],
      rows: [],
    })),
  ]);
  const idleIdx = hist.dimensionNames.indexOf("idle");
  const history =
    idleIdx >= 0
      ? hist.rows.map((row) => Math.max(0, 100 - (row[idleIdx] ?? 0)))
      : [];
  return { current: extractCpu(metrics), history };
}

export function NetdataCpuWidget({
  data,
  loading,
  error,
}: WidgetProps<CpuData>) {
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

  return (
    <div className="netdata-widget" aria-label="CPU usage">
      <span className="netdata-widget__label">CPU</span>
      {data.history.length >= 2 && <Sparkline values={data.history} />}
      <span className="netdata-widget__value">{data.current.toFixed(1)}%</span>
      {error && (
        <span className="netdata-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<NetdataBaseConfig, CpuData>({
  id: "netdata-cpu",
  name: "Netdata CPU",
  configSchema: NetdataBaseConfigSchema,
  fetchData: fetchCpuData,
  refreshInterval: 10_000,
  component: NetdataCpuWidget,
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
    defaultName: "CPU",
    defaultIconUrl: "https://cdn.simpleicons.org/netdata",
  },
});
