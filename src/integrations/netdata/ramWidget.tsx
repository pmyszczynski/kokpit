import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import {
  NetdataBaseConfigSchema,
  fetchAllMetrics,
  fetchChartHistory,
  extractRam,
} from "./api";
import type { NetdataBaseConfig, RawChartHistory } from "./api";
import { Sparkline } from "./Sparkline";

interface RamData {
  usedBytes: number;
  totalBytes: number;
  history: number[];
}

function fmtBytes(b: number): string {
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`;
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(0)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}

async function fetchRamData(
  config: NetdataBaseConfig,
  signal?: AbortSignal
): Promise<RamData> {
  const [metrics, hist] = await Promise.all([
    fetchAllMetrics(config, signal),
    fetchChartHistory(config, "system.ram", signal).catch(
      (): RawChartHistory => ({ dimensionNames: [], rows: [] })
    ),
  ]);
  const MiB = 1_048_576;
  const usedIdx = hist.dimensionNames.indexOf("used");
  const cachedIdx = hist.dimensionNames.indexOf("cached");
  const bufIdx = hist.dimensionNames.indexOf("buffers");
  const history = hist.rows.map((row) => {
    const u = usedIdx >= 0 ? (row[usedIdx] ?? 0) : 0;
    const c = cachedIdx >= 0 ? (row[cachedIdx] ?? 0) : 0;
    const bk = bufIdx >= 0 ? (row[bufIdx] ?? 0) : 0;
    return (u + c + bk) * MiB;
  });
  const { usedBytes, totalBytes } = extractRam(metrics);
  return { usedBytes, totalBytes, history };
}

export function NetdataRamWidget({
  data,
  loading,
  error,
}: WidgetProps<RamData>) {
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
    <div className="netdata-widget" aria-label="RAM usage">
      <span className="netdata-widget__label">RAM</span>
      {data.history.length >= 2 && <Sparkline values={data.history} />}
      <span className="netdata-widget__value">{fmtBytes(data.usedBytes)}</span>
      <span className="netdata-widget__subvalue">
        of {fmtBytes(data.totalBytes)}
      </span>
      {error && (
        <span className="netdata-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<NetdataBaseConfig, RamData>({
  id: "netdata-ram",
  name: "Netdata RAM",
  preferredSize: "normal",
  configSchema: NetdataBaseConfigSchema,
  fetchData: fetchRamData,
  refreshInterval: 10_000,
  component: NetdataRamWidget,
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
    defaultName: "RAM",
    defaultIconUrl: "https://cdn.simpleicons.org/netdata",
  },
});
