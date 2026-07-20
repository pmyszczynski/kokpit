import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { NetdataBaseConfigSchema, fetchAllMetrics, extractLoad } from "./api";
import type { NetdataBaseConfig } from "./api";

interface LoadData {
  one: number;
  five: number;
  fifteen: number;
}

async function fetchLoadData(
  config: NetdataBaseConfig,
  signal?: AbortSignal
): Promise<LoadData> {
  const metrics = await fetchAllMetrics(config, signal);
  return extractLoad(metrics);
}

export function NetdataLoadWidget({
  data,
  loading,
  error,
}: WidgetProps<LoadData>) {
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
    <div className="netdata-widget" aria-label="Load average">
      <span className="netdata-widget__label">Load Average</span>
      <div className="netdata-load-widget__row">
        <span className="netdata-load-widget__cell">
          <span className="netdata-widget__value">{data.one.toFixed(2)}</span>
          <span className="netdata-widget__label">1m</span>
        </span>
        <span className="netdata-load-widget__cell">
          <span className="netdata-widget__value">{data.five.toFixed(2)}</span>
          <span className="netdata-widget__label">5m</span>
        </span>
        <span className="netdata-load-widget__cell">
          <span className="netdata-widget__value">
            {data.fifteen.toFixed(2)}
          </span>
          <span className="netdata-widget__label">15m</span>
        </span>
      </div>
      {error && (
        <span className="netdata-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<NetdataBaseConfig, LoadData>({
  id: "netdata-load",
  name: "Netdata Load",
  preferredSize: "normal",
  configSchema: NetdataBaseConfigSchema,
  fetchData: fetchLoadData,
  refreshInterval: 10_000,
  component: NetdataLoadWidget,
  configFields: [
    {
      key: "url",
      label: "Netdata URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:19999",
    },
    { key: "api_token", label: "API Token", type: "password", required: false },
  ],
  serviceEditorPreset: {
    defaultName: "Load Average",
    defaultIconUrl: "https://cdn.simpleicons.org/netdata",
  },
});
