import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { SystemStatsConfigSchema, fetchSystemStats } from "./api";
import type { SystemStatsConfig, SystemStatsData } from "./api";

// --- Local formatters (per-file duplication is the repo convention) ---

const UNITS = [
  { div: 1_073_741_824, suffix: "GB" },
  { div: 1_048_576, suffix: "MB" },
  { div: 1024, suffix: "KB" },
] as const;

function pickUnit(bytes: number): { div: number; suffix: string } {
  const abs = Math.abs(bytes);
  for (const unit of UNITS) {
    if (abs >= unit.div) return unit;
  }
  return { div: 1, suffix: "B" };
}

function trimTrailingZero(s: string): string {
  return s.replace(/\.0$/, "");
}

/** Formats a single byte count, e.g. `1.2 GB`. */
function fmtBytes(bytes: number): string {
  const { div, suffix } = pickUnit(bytes);
  return `${trimTrailingZero((bytes / div).toFixed(1))} ${suffix}`;
}

/** Formats `used / total` sharing one unit scaled off `total`, e.g. `3.2 / 16 GB`. */
function fmtBytesPair(used: number, total: number): string {
  const { div, suffix } = pickUnit(total);
  const usedStr = trimTrailingZero((used / div).toFixed(1));
  const totalStr = trimTrailingZero((total / div).toFixed(1));
  return `${usedStr} / ${totalStr} ${suffix}`;
}

/** Formats a throughput rate, e.g. `1.2 MB/s` or `240 KB/s`. Decimal (1000) based. */
function fmtRate(bytesPerSec: number): string {
  const abs = Math.abs(bytesPerSec);
  if (abs >= 1_000_000) {
    return `${trimTrailingZero((bytesPerSec / 1_000_000).toFixed(1))} MB/s`;
  }
  if (abs >= 1_000) {
    return `${trimTrailingZero((bytesPerSec / 1_000).toFixed(1))} KB/s`;
  }
  return `${Math.round(bytesPerSec)} B/s`;
}

function pct(n: number): number {
  return Math.round(n);
}

// --- Presentational helpers ---

function Bar({ value }: { value: number }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className="system-stats-widget__bar">
      <div
        className="system-stats-widget__bar-fill"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function StatRow({
  label,
  value,
  sub,
  barValue,
  title,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  barValue?: number;
  title?: string;
}) {
  return (
    <div className="system-stats-widget__row" title={title}>
      <div className="system-stats-widget__row-header">
        <span className="system-stats-widget__row-label">{label}</span>
        <span className="system-stats-widget__row-value">
          {value}
          {sub != null && (
            <span className="system-stats-widget__row-sub"> {sub}</span>
          )}
        </span>
      </div>
      {barValue !== undefined && <Bar value={barValue} />}
    </div>
  );
}

export function SystemStatsWidget({
  data,
  loading,
  error,
}: WidgetProps<SystemStatsData>) {
  if (!data) {
    return (
      <div className="system-stats-widget system-stats-widget--empty">
        {loading && (
          <span className="system-stats-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="system-stats-widget__hint system-stats-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  const hasAnyField =
    data.cpu !== null ||
    data.memory !== null ||
    data.disk !== null ||
    data.network !== null ||
    data.load !== null ||
    data.docker !== null ||
    data.dockerError !== null;

  if (!hasAnyField) {
    return (
      <div
        className="system-stats-widget system-stats-widget--empty"
        aria-label="System stats"
      >
        <span className="system-stats-widget__hint">No stats to show</span>
        {error && (
          <span className="system-stats-widget__stale-error" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="system-stats-widget" aria-label="System stats">
      {data.cpu && (
        <StatRow
          label="CPU"
          value={`${pct(data.cpu.usagePercent)}%`}
          barValue={data.cpu.usagePercent}
        />
      )}
      {data.memory && (
        <StatRow
          label="Memory"
          value={fmtBytesPair(data.memory.used, data.memory.total)}
          sub={`(${pct(data.memory.usagePercent)}%)`}
          barValue={data.memory.usagePercent}
          title={`${fmtBytes(data.memory.available)} available`}
        />
      )}
      {data.disk && (
        <StatRow
          label={`Disk (${data.disk.path})`}
          value={fmtBytesPair(data.disk.used, data.disk.total)}
          sub={`(${pct(data.disk.usagePercent)}%)`}
          barValue={data.disk.usagePercent}
          title={`${fmtBytes(data.disk.available)} available`}
        />
      )}
      {data.network && (
        <div className="system-stats-widget__row">
          <div className="system-stats-widget__row-header">
            <span className="system-stats-widget__row-label">Network</span>
          </div>
          <div className="system-stats-widget__net-rates">
            <span className="system-stats-widget__net-rate">
              ↓ {fmtRate(data.network.rxBytesPerSec)}
            </span>
            <span className="system-stats-widget__net-rate">
              ↑ {fmtRate(data.network.txBytesPerSec)}
            </span>
          </div>
        </div>
      )}
      {data.load && (
        <div className="system-stats-widget__row">
          <div className="system-stats-widget__row-header">
            <span className="system-stats-widget__row-label">Load</span>
          </div>
          <div className="system-stats-widget__load-row">
            <span className="system-stats-widget__load-cell">
              {data.load.one.toFixed(2)}
            </span>
            <span className="system-stats-widget__load-cell">
              {data.load.five.toFixed(2)}
            </span>
            <span className="system-stats-widget__load-cell">
              {data.load.fifteen.toFixed(2)}
            </span>
          </div>
        </div>
      )}
      {(data.docker !== null || data.dockerError !== null) && (
        <div className="system-stats-widget__row">
          <div className="system-stats-widget__row-header">
            <span className="system-stats-widget__row-label">Docker</span>
            {data.docker && (
              <span className="system-stats-widget__row-value">
                {data.docker.running} / {data.docker.total} running
              </span>
            )}
          </div>
          {data.dockerError && (
            <span
              className="system-stats-widget__hint"
              title={data.dockerError}
            >
              Docker unavailable
            </span>
          )}
        </div>
      )}
      {error && (
        <span className="system-stats-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<SystemStatsConfig, SystemStatsData>({
  id: "system-stats",
  name: "System Stats",
  preferredSize: "tall",
  minSize: "normal",
  configSchema: SystemStatsConfigSchema,
  fetchData: fetchSystemStats,
  refreshInterval: 10_000,
  component: SystemStatsWidget,
  configFields: [
    {
      key: "proc_path",
      label: "Proc path",
      type: "text",
      placeholder: "/proc",
      description:
        "Path to procfs. When running in Docker, bind-mount the host's /proc and point here.",
    },
    {
      key: "disk_path",
      label: "Disk path",
      type: "text",
      placeholder: "/",
      description: "Filesystem mount to report disk usage for.",
    },
    {
      key: "interface",
      label: "Network interface",
      type: "text",
      placeholder: "eth0",
      description:
        "Interface to measure. Leave empty to sum all non-loopback interfaces.",
    },
    {
      key: "docker_socket_path",
      label: "Docker socket",
      type: "text",
      placeholder: "/var/run/docker.sock",
      description:
        "Docker socket for the container overview (used only when Docker is in Fields).",
    },
    {
      key: "fields",
      label: "Fields",
      type: "multiselect",
      description: "Which stats to display.",
      options: [
        { value: "cpu", label: "CPU" },
        { value: "memory", label: "Memory" },
        { value: "disk", label: "Disk" },
        { value: "network", label: "Network" },
        { value: "load", label: "Load average" },
        { value: "docker", label: "Docker containers" },
      ],
    },
  ],
  serviceEditorPreset: {
    defaultName: "System",
    defaultIconUrl: "https://cdn.simpleicons.org/linux/FCC624",
  },
});
