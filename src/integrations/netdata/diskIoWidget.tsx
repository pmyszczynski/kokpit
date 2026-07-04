import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import {
  NetdataBaseConfigSchema,
  fetchAllMetrics,
  fetchChartHistory,
  extractDiskIo,
} from "./api";
import type { NetdataBaseConfig, RawChartHistory } from "./api";
import { Sparkline } from "./Sparkline";

interface DiskIoData {
  readBps: number;
  writeBps: number;
  readHistory: number[];
  writeHistory: number[];
}

function fmtBps(bps: number): string {
  const abs = Math.abs(bps);
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)} MB/s`;
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)} KB/s`;
  return `${abs.toFixed(0)} B/s`;
}

async function fetchDiskIoData(
  config: NetdataBaseConfig,
  signal?: AbortSignal
): Promise<DiskIoData> {
  const [metrics, hist] = await Promise.all([
    fetchAllMetrics(config, signal),
    fetchChartHistory(config, "system.io", signal).catch(
      (): RawChartHistory => ({ dimensionNames: [], rows: [] })
    ),
  ]);
  // system.io is in KiB/s; convert to bytes/s
  const toBytes = (kib: number) => Math.abs(kib) * 1024;
  const inIdx = hist.dimensionNames.indexOf("in");
  const outIdx = hist.dimensionNames.indexOf("out");
  const readHistory =
    inIdx >= 0 ? hist.rows.map((row) => toBytes(row[inIdx] ?? 0)) : [];
  const writeHistory =
    outIdx >= 0 ? hist.rows.map((row) => toBytes(row[outIdx] ?? 0)) : [];
  const { readBps, writeBps } = extractDiskIo(metrics);
  return { readBps, writeBps, readHistory, writeHistory };
}

export function NetdataDiskIoWidget({
  data,
  loading,
  error,
}: WidgetProps<DiskIoData>) {
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
    data.readHistory.length >= 2
      ? data.readHistory.map((v, i) => v + (data.writeHistory[i] ?? 0))
      : [];

  return (
    <div className="netdata-widget" aria-label="Disk I/O">
      <span className="netdata-widget__label">Disk I/O</span>
      {combined.length >= 2 && <Sparkline values={combined} />}
      <span className="netdata-widget__value">R {fmtBps(data.readBps)}</span>
      <span className="netdata-widget__subvalue">W {fmtBps(data.writeBps)}</span>
      {error && (
        <span className="netdata-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<NetdataBaseConfig, DiskIoData>({
  id: "netdata-disk-io",
  name: "Netdata Disk I/O",
  configSchema: NetdataBaseConfigSchema,
  fetchData: fetchDiskIoData,
  refreshInterval: 10_000,
  component: NetdataDiskIoWidget,
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
    defaultName: "Disk I/O",
    defaultIconUrl: "https://cdn.simpleicons.org/netdata",
  },
});
