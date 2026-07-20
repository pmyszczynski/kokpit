import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { z } from "zod";
import {
  NetdataBaseConfigSchema,
  fetchAllMetrics,
  extractDiskSpace,
} from "./api";
import type { NetdataBaseConfig } from "./api";

const DiskSpaceConfigSchema = NetdataBaseConfigSchema.extend({
  chart_id: z.string().optional(),
});
type DiskSpaceConfig = z.infer<typeof DiskSpaceConfigSchema>;

interface DiskSpaceData {
  usedBytes: number;
  totalBytes: number;
}

function fmtBytes(b: number): string {
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`;
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(0)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}

async function fetchDiskSpaceData(
  config: DiskSpaceConfig,
  signal?: AbortSignal
): Promise<DiskSpaceData> {
  const metrics = await fetchAllMetrics(config, signal);
  return extractDiskSpace(metrics, config.chart_id ?? "disk_space._");
}

export function NetdataDiskSpaceWidget({
  data,
  loading,
  error,
}: WidgetProps<DiskSpaceData>) {
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

  const pct =
    data.totalBytes > 0
      ? Math.round((data.usedBytes / data.totalBytes) * 100)
      : 0;

  return (
    <div className="netdata-widget" aria-label="Disk space">
      <span className="netdata-widget__label">Disk</span>
      <span className="netdata-widget__value">{fmtBytes(data.usedBytes)}</span>
      <span className="netdata-widget__subvalue">
        of {fmtBytes(data.totalBytes)} ({pct}%)
      </span>
      {error && (
        <span className="netdata-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<DiskSpaceConfig, DiskSpaceData>({
  id: "netdata-disk-space",
  name: "Netdata Disk Space",
  preferredSize: "normal",
  configSchema: DiskSpaceConfigSchema,
  fetchData: fetchDiskSpaceData,
  refreshInterval: 60_000,
  component: NetdataDiskSpaceWidget,
  configFields: [
    {
      key: "url",
      label: "Netdata URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:19999",
    },
    {
      key: "chart_id",
      label: "Chart ID",
      type: "text",
      required: false,
      placeholder: "disk_space._",
      description:
        'Netdata disk_space chart ID. Default "disk_space._" monitors root (/). Find others at <netdata-url>/api/v1/charts.',
    },
    { key: "api_token", label: "API Token", type: "password", required: false },
  ],
  serviceEditorPreset: {
    defaultName: "Disk Space",
    defaultIconUrl: "https://cdn.simpleicons.org/netdata",
  },
});
