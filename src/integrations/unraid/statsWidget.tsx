import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { WidgetBody, WidgetStatGrid, WidgetStat, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import type { WidgetStatTone } from "@/widgets/ui";
import { fetchStats, UnraidConfigSchema } from "./api";
import type { UnraidConfig, UnraidStats } from "./api";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) {
    return `${(bytes / 1024 ** 4).toFixed(1)} TiB`;
  }
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  }
  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${bytes} B`;
}

function formatArrayState(state: string): string {
  return state
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatParityStatus(status: string): string {
  if (status === "") return "OK";
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function UnraidStatsWidget({
  data,
  loading,
  error,
  footprint,
}: WidgetProps<UnraidStats>) {
  if (!data) {
    return (
      <WidgetBody centered className="unraid-stats-widget unraid-stats-widget--empty">
        <WidgetState state={loading ? "loading" : error ? "error" : "empty"}
          className="unraid-stats-widget__hint" labelClassName="unraid-stats-widget__hint--error">
          {!loading ? error : undefined}
        </WidgetState>
      </WidgetBody>
    );
  }

  const usedPct =
    data.totalBytes > 0
      ? Math.round((data.usedBytes / data.totalBytes) * 100)
      : 0;

  const footprintName = `${footprint?.columnSpan ?? 6}x${footprint?.rowSpan ?? 4}`;
  const detailed = footprintName === "3x4" || footprintName === "6x4";
  const parityErrors = data.parityErrors;
  const needsAttention = data.diskErrors > 0 || (parityErrors ?? 0) > 0;
  const arrayTone: WidgetStatTone = (!detailed && needsAttention) || data.arrayState.toUpperCase().includes("INVALID")
    ? "alert" : data.arrayState.toUpperCase() === "STARTED" ? "positive" : "neutral";
  const parityTone: WidgetStatTone = data.parityStatus === null ? "neutral" : (parityErrors ?? 0) > 0 ? "alert"
    : data.parityStatus === "" ? "positive"
    : data.parityStatus?.toUpperCase() === "STARTED" ? "warning" : "neutral";
  const stats = {
    array: { label: !detailed && needsAttention ? "Needs attention" : "Array", value: formatArrayState(data.arrayState), tone: arrayTone,
      tooltip: `Array: ${formatArrayState(data.arrayState)}; disk errors: ${data.diskErrors}; parity errors: ${parityErrors ?? "not reported"}` },
    used: { label: `Used (${usedPct}%)`, value: formatBytes(data.usedBytes), tone: "info",
      supporting: `/ ${formatBytes(data.totalBytes)}`, tooltip: `${formatBytes(data.usedBytes)} / ${formatBytes(data.totalBytes)} (${usedPct}%)` },
    disks: { label: "Disks", value: data.diskCount, tone: "info" },
    errors: { label: "Errors", value: data.diskErrors, tone: data.diskErrors > 0 ? "alert" : "neutral" },
    parity: { label: "Parity", value: data.parityStatus === null ? "—" : formatParityStatus(data.parityStatus),
      tone: parityTone, supporting: data.parityDate ?? undefined,
      tooltip: data.parityStatus === null ? "No parity status reported"
        : `${formatParityStatus(data.parityStatus)}${data.parityDate ? ` · ${data.parityDate}` : ""}; errors: ${parityErrors ?? "not reported"}` },
    parityErrors: { label: "Parity Errors", value: parityErrors ?? "—", tone: (parityErrors ?? 0) > 0 ? "alert" : "neutral" },
  } satisfies Record<string, { label: string; value: string | number; tone: WidgetStatTone; supporting?: string; tooltip?: string }>;
  const fields: (keyof typeof stats)[] = detailed ? ["array", "used", "disks", "errors", "parity", "parityErrors"]
    : footprintName === "6x2" ? ["array", "used", "errors"] : ["array", "used"];

  return (
    <WidgetBody className="unraid-stats-widget" aria-label="Unraid stats" data-footprint={footprintName}
      scrollLabel="Unraid measurements" reserveNotice
      notice={<WidgetStaleNotice error={error} className="unraid-stats-widget__stale-error" />}>
      <WidgetStatGrid columns={footprintName.startsWith("6x") ? 3 : 2} className="unraid-stats-widget__grid">
        {fields.map(key => {
          const stat = stats[key];
          return <WidgetStat key={key} label={stat.label} value={stat.value} tone={stat.tone}
            aria-label={key === "array" ? "Array" : undefined}
            data-field={key} valueTooltip={"tooltip" in stat ? stat.tooltip : undefined}
            supportingValue={"supporting" in stat ? stat.supporting : undefined}
            supportingValueClassName={key === "used" ? "unraid-stats-widget__sub" : undefined}
            className={`unraid-stats-widget__stat unraid-stats-widget__stat--${key}`}
            valueClassName={`unraid-stats-widget__value${stat.tone === "alert" ? " unraid-stats-widget__value--error" : ""}`}
            labelClassName="unraid-stats-widget__label" />;
        })}
      </WidgetStatGrid>
    </WidgetBody>
  );
}

registerWidget<UnraidConfig, UnraidStats>({
  id: "unraid-stats",
  name: "Unraid Stats",
  preferredSize: "large",
  compactHeader: true,
  sharedUI: true,
  sharedStateClassNames: {
    wrapper: "unraid-stats-widget unraid-stats-widget--empty",
    loading: "unraid-stats-widget__hint",
    error: "unraid-stats-widget__hint unraid-stats-widget__hint--error",
  },
  supportedFootprints: [
    { label: "Compact", columnSpan: 3, rowSpan: 2 },
    { label: "Detailed", columnSpan: 3, rowSpan: 4 },
    { label: "Wide", columnSpan: 6, rowSpan: 2 },
    { label: "Legacy", columnSpan: 6, rowSpan: 4 },
  ],
  serviceEditorPreset: {
    defaultName: "Unraid",
    defaultIconUrl: "https://cdn.simpleicons.org/unraid",
  },
  configSchema: UnraidConfigSchema,
  fetchData: fetchStats,
  refreshInterval: 30_000,
  component: UnraidStatsWidget,
  credentialScopeFields: ["url"],
  configFields: [
    {
      key: "url",
      label: "URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x",
    },
    {
      key: "api_key",
      label: "API Key",
      type: "password",
      required: true,
      description:
        "Create an API key in Settings > Management Access > API Keys",
    },
  ],
});
