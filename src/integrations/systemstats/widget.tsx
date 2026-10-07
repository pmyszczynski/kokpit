import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { SystemStatsConfigSchema, fetchSystemStats } from "./api";
import type { SystemStatsConfig, SystemStatsData } from "./api";
import { WidgetBody, WidgetStat, WidgetStatGrid, WidgetStatRow, WidgetBar, WidgetState, WidgetStaleNotice } from "@/widgets/ui";

// --- Local formatters (per-file duplication is the repo convention) ---

const UNITS = [
  { div: 1_073_741_824, suffix: "GiB" },
  { div: 1_048_576, suffix: "MiB" },
  { div: 1024, suffix: "KiB" },
] as const;

/** Picks the largest binary unit (GiB/MiB/KiB/B) `bytes` fits, for formatting. */
function pickUnit(bytes: number): { div: number; suffix: string } {
  const abs = Math.abs(bytes);
  for (const unit of UNITS) {
    if (abs >= unit.div) return unit;
  }
  return { div: 1, suffix: "B" };
}

/** Strips a redundant `.0` from a fixed-precision number string, e.g. `"3.0"` → `"3"`. */
function trimTrailingZero(s: string): string {
  return s.replace(/\.0$/, "");
}

/** Formats a single byte count, e.g. `1.2 GiB`. */
function fmtBytes(bytes: number): string {
  const { div, suffix } = pickUnit(bytes);
  return `${trimTrailingZero((bytes / div).toFixed(1))} ${suffix}`;
}

/** Formats `used / total` sharing one unit scaled off `total`, e.g. `3.2 / 16 GiB`. */
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

/** Rounds a percentage for display. */
function pct(n: number): number {
  return Math.round(n);
}

/** Renders host measurements; fetching, optional fields and formatting remain domain-owned. */
export function SystemStatsWidget({ data, loading, error, footprint }: WidgetProps<SystemStatsData>) {
  if (!data) {
    return <WidgetBody centered className="system-stats-widget system-stats-widget--empty">
      <WidgetState state={loading ? "loading" : error ? "error" : "empty"}
        className="system-stats-widget__hint" labelClassName="system-stats-widget__hint system-stats-widget__hint--error">
        {loading ? "Loading…" : error}
      </WidgetState>
    </WidgetBody>;
  }

  const footprintName = `${footprint?.columnSpan ?? 3}x${footprint?.rowSpan ?? 4}`;
  const summarySize = footprintName === "3x2" || footprintName === "6x2";
  const hasExtraFields = data.network !== null || data.load !== null || data.docker !== null || data.dockerError !== null ||
    (footprintName === "3x2" && data.disk !== null);
  // A custom or legacy selection is always rendered completely, even on a short canvas.
  if (summarySize && !hasExtraFields && (data.cpu || data.memory || data.disk)) {
    const stats = [
      ...(data.cpu ? [{ key: "cpu", label: "CPU", value: `${pct(data.cpu.usagePercent)}%`, tooltip: undefined }] : []),
      ...(data.memory ? [{ key: "memory", label: "Memory", value: `${pct(data.memory.usagePercent)}%`, tooltip: `${fmtBytesPair(data.memory.used, data.memory.total)} (${pct(data.memory.usagePercent)}%); ${fmtBytes(data.memory.available)} available` }] : []),
      ...(data.disk ? [{ key: "disk", label: "Disk", value: `${pct(data.disk.usagePercent)}%`, tooltip: `${data.disk.path}: ${fmtBytesPair(data.disk.used, data.disk.total)} (${pct(data.disk.usagePercent)}%); ${fmtBytes(data.disk.available)} available` }] : []),
    ];
    return <WidgetBody className="system-stats-widget" data-footprint={footprintName} aria-label="System stats" reserveNotice
      notice={<WidgetStaleNotice error={error} className="system-stats-widget__stale-error" />}>
      <WidgetStatGrid columns={footprintName === "6x2" ? 3 : 2} className="system-stats-widget__grid">
        {stats.map(stat => <WidgetStat key={stat.key} label={stat.label} value={stat.value} tone="info" valueTooltip={stat.tooltip}
          className={`system-stats-widget__stat system-stats-widget__stat--${stat.key}`}
          labelClassName="system-stats-widget__row-label" valueClassName="system-stats-widget__row-value" />)}
      </WidgetStatGrid>
    </WidgetBody>;
  }

  const hasAnyField = data.cpu !== null || data.memory !== null || data.disk !== null ||
    data.network !== null || data.load !== null || data.docker !== null || data.dockerError !== null;
  const rowHooks = {
    className: "system-stats-widget__row", headerClassName: "system-stats-widget__row-header",
    labelClassName: "system-stats-widget__row-label", valueClassName: "system-stats-widget__row-value",
    subValueClassName: "system-stats-widget__row-sub",
  };
  const usageBar = (label: string, value: number, valueText: string) =>
    <WidgetBar kind="usage" label={label} value={value} valueText={valueText} tone="info"
      trackClassName="system-stats-widget__bar" fillClassName="system-stats-widget__bar-fill" />;

  return <WidgetBody className={`system-stats-widget${hasAnyField ? "" : " system-stats-widget--empty"}`}
    data-footprint={footprintName} aria-label="System stats" scrollLabel={hasAnyField ? "System stats measurements" : undefined}
    contentCentered={!hasAnyField} reserveNotice
    notice={<WidgetStaleNotice error={error} className="system-stats-widget__stale-error" />}>
    {!hasAnyField && <WidgetState state="empty" className="system-stats-widget__hint">No stats to show</WidgetState>}
    {data.cpu && <WidgetStatRow {...rowHooks} label="CPU" tone="info" value={`${pct(data.cpu.usagePercent)}%`}
      bar={usageBar("CPU usage", data.cpu.usagePercent, `${pct(data.cpu.usagePercent)}%`)} />}
    {data.memory && <WidgetStatRow {...rowHooks} label="Memory" tone="info" value={fmtBytesPair(data.memory.used, data.memory.total)}
      subValue={`(${pct(data.memory.usagePercent)}%)`} title={`${fmtBytes(data.memory.available)} available`}
      bar={usageBar("Memory usage", data.memory.usagePercent, `${fmtBytesPair(data.memory.used, data.memory.total)} (${pct(data.memory.usagePercent)}%)`)} />}
    {data.disk && <WidgetStatRow {...rowHooks} label={`Disk (${data.disk.path})`} tone="info" value={fmtBytesPair(data.disk.used, data.disk.total)}
      subValue={`(${pct(data.disk.usagePercent)}%)`} title={`${fmtBytes(data.disk.available)} available`}
      bar={usageBar(`Disk (${data.disk.path}) usage`, data.disk.usagePercent, `${fmtBytesPair(data.disk.used, data.disk.total)} (${pct(data.disk.usagePercent)}%)`)} />}
    {data.network && <WidgetStatRow {...rowHooks} label="Network" valuesClassName="system-stats-widget__net-rates"
      values={[
        { content: `↓ ${fmtRate(data.network.rxBytesPerSec)}`, tone: data.network.rxBytesPerSec > 0 ? "positive" : "neutral", className: "system-stats-widget__net-rate" },
        { content: `↑ ${fmtRate(data.network.txBytesPerSec)}`, tone: data.network.txBytesPerSec > 0 ? "info" : "neutral", className: "system-stats-widget__net-rate" },
      ]} />}
    {data.load && <WidgetStatRow {...rowHooks} label="Load" tone="info" valuesClassName="system-stats-widget__load-row"
      values={[
        { content: data.load.one.toFixed(2), title: "1-minute load average", className: "system-stats-widget__load-cell" },
        { content: data.load.five.toFixed(2), title: "5-minute load average", className: "system-stats-widget__load-cell" },
        { content: data.load.fifteen.toFixed(2), title: "15-minute load average", className: "system-stats-widget__load-cell" },
      ]} />}
    {(data.docker !== null || data.dockerError !== null) && <WidgetStatRow {...rowHooks} label="Docker" tone="info"
      value={data.docker ? `${data.docker.running} / ${data.docker.total} running` : undefined}
      detail={data.dockerError ? <span className="system-stats-widget__hint" title={data.dockerError}>Docker unavailable</span> : undefined} />}
  </WidgetBody>;
}

registerWidget<SystemStatsConfig, SystemStatsData>({
  id: "system-stats",
  name: "System Stats",
  preferredSize: "normal",
  compactHeader: true,
  sharedUI: true,
  sharedStateClassNames: {
    wrapper: "system-stats-widget system-stats-widget--empty",
    loading: "system-stats-widget__hint",
    error: "system-stats-widget__hint system-stats-widget__hint--error",
  },
  supportedFootprints: [
    { label: "Compact", columnSpan: 3, rowSpan: 2 },
    { label: "Detailed", columnSpan: 3, rowSpan: 4 },
    { label: "Wide", columnSpan: 6, rowSpan: 2 },
  ],
  minSize: "normal",
  preservedConfigFields: [{ key: "size_defaults", type: "boolean" }],
  configSchema: SystemStatsConfigSchema,
  fetchData: fetchSystemStats,
  refreshInterval: 10_000,
  // Docker's ping/list requests can each take 3s, plus the 250ms host sample.
  fetchTimeoutMs: 8_000,
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
      description: "Choose fields to override the default selection.",
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
    defaultConfig: { size_defaults: true },
    defaultName: "System",
    defaultIconUrl: "https://cdn.simpleicons.org/linux/FCC624",
  },
});
