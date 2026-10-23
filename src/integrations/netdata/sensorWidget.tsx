import {
  netdataSetupGuide,
  netdataUrlDescription,
  netdataTokenDescription,
  netdataHistoryDescription,
} from "./setupGuide";
import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { z } from "zod";
import {
  NetdataBaseConfigSchema,
  fetchAllMetrics,
  fetchChartHistory,
  extractSensor,
} from "./api";
import type { RawChartHistory } from "./api";
import { Sparkline } from "./Sparkline";

const SensorConfigSchema = NetdataBaseConfigSchema.extend({
  chart_id: z.string().min(1),
  label: z.string().optional(),
});
type SensorConfig = z.infer<typeof SensorConfigSchema>;

interface SensorData {
  value: number;
  units: string;
  history: number[];
  label: string;
}

async function fetchSensorData(
  config: SensorConfig,
  signal?: AbortSignal
): Promise<SensorData> {
  const [metrics, hist] = await Promise.all([
    fetchAllMetrics(config, signal),
    fetchChartHistory(config, config.chart_id, signal).catch(
      (): RawChartHistory => ({ dimensionNames: [], rows: [] })
    ),
  ]);

  const sensor = extractSensor(metrics, config.chart_id);
  if (!sensor) {
    throw new Error(
      `Chart "${config.chart_id}" not found. Find available charts at <netdata-url>/api/v1/charts`
    );
  }

  const history = hist.rows.map((row) => {
    const vals = row.filter((v) => Number.isFinite(v));
    return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  });

  return {
    value: sensor.value,
    units: sensor.units,
    history,
    label: config.label ?? config.chart_id.split(".").pop() ?? config.chart_id,
  };
}

export function NetdataSensorWidget({
  data,
  loading,
  error,
}: WidgetProps<SensorData>) {
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

  const isCelsius = data.units === "Celsius";
  const isFahrenheit = data.units === "Fahrenheit";
  const unit = isCelsius ? "°C" : isFahrenheit ? "°F" : ` ${data.units}`;

  return (
    <div className="netdata-widget" aria-label={data.label}>
      <span className="netdata-widget__label">{data.label}</span>
      {data.history.length >= 2 && <Sparkline values={data.history} />}
      <span className="netdata-widget__value">
        {data.value.toFixed(1)}
        {unit}
      </span>
      {error && (
        <span className="netdata-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<SensorConfig, SensorData>({
  id: "netdata-sensor",
  name: "Netdata Sensor",
  preferredSize: "normal",
  supportedFootprints: [{ label: "Default", columnSpan: 3, rowSpan: 2 }],
  footprintDescription: "Default (3×2) shows the mean of the selected chart’s finite current dimensions in its reported units and, when available, one history sparkline. Refresh defaults to 10 seconds.",
  setupGuide: netdataSetupGuide,
  configSchema: SensorConfigSchema,
  fetchData: fetchSensorData,
  refreshInterval: 10_000,
  component: NetdataSensorWidget,
  credentialScopeFields: ["url"],
  configFields: [
    {
      key: "url",
      label: "Netdata URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:19999",
      description: netdataUrlDescription,
    },
    {
      key: "chart_id",
      label: "Chart ID",
      type: "text",
      required: true,
      placeholder: "sensors.coretemp_isa_0000",
      description:
        "Required exact key from the Agent’s allmetrics charts map; see chart discovery in the guide. No default. All finite current dimensions are averaged, so choose a chart whose dimensions should be combined. Uses the chart’s units, such as Celsius or RPM.",
    },
    {
      key: "label",
      label: "Label",
      type: "text",
      required: false,
      placeholder: "CPU Temp",
      description: "Optional heading inside the tile. Empty uses the part of Chart ID after its final dot. This does not rename the service, select a sensor dimension or change units.",
    },
    { key: "api_token", label: "API Token", type: "password", required: false, description: netdataTokenDescription },
    {
      key: "history_minutes",
      label: "History (minutes)",
      type: "number",
      placeholder: "10",
      required: false,
      description: netdataHistoryDescription,
    },
  ],
  serviceEditorPreset: {
    defaultName: "Sensor",
    defaultIconUrl: "https://cdn.simpleicons.org/netdata",
  },
});
