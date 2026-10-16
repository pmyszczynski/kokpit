import { registerWidget, type WidgetProps, type WidgetConfigField } from "@/widgets";
import { WidgetBody, WidgetStatGrid, WidgetStat, WidgetList, WidgetListItem, WidgetBadge, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import { fetchWeather, WeatherConfigSchema, type WeatherConfig, type WeatherData } from "./api";
import type { WidgetStatTone } from "@/widgets/ui";
import { weatherCondition, weatherTone } from "./conditions";
import "./widget.css";

function temperature(value: number | null, imperial: boolean) {
  return value == null ? "—" : `${Math.round(value)}°${imperial ? "F" : "C"}`;
}

function forecastDate(date: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));
}

export function WeatherWidget({ data, loading, error, footprint }: WidgetProps<WeatherData>) {
  if (!data) return <WidgetBody centered className="weather-widget">
    <WidgetState state={loading ? "loading" : error ? "error" : "empty"}>{!loading ? error ?? "Weather unavailable" : undefined}</WidgetState>
  </WidgetBody>;
  const detailed = (footprint?.rowSpan ?? 2) >= 4;
  const wide = (footprint?.columnSpan ?? 3) >= 6;
  const firstDay = data.forecast[0];
  const measurements: { label: string; value: string; tone: WidgetStatTone }[] = [
    { label: "Temperature", value: temperature(data.temperature, data.imperial), tone: data.temperature == null ? "neutral" : "info" },
    { label: "Conditions", value: weatherCondition(data.code, data.isDay), tone: weatherTone(data.code) },
  ];
  if (wide || detailed) measurements.push({ label: "Feels like", value: temperature(data.feelsLike, data.imperial), tone: data.feelsLike == null ? "neutral" : "info" });
  if (detailed) measurements.push(
      { label: "Humidity", value: data.humidity == null ? "—" : `${Math.round(data.humidity)}%`, tone: data.humidity == null ? "neutral" : "info" },
      { label: "Wind", value: data.wind == null ? "—" : `${Math.round(data.wind)} ${data.imperial ? "mph" : "km/h"}`, tone: data.wind == null ? "neutral" : "info" },
      { label: firstDay ? `Precip · ${forecastDate(firstDay.date)}` : "Precipitation",
        value: firstDay?.precipitation == null ? "—" : `${Math.round(firstDay.precipitation)}%`,
        tone: firstDay?.precipitation == null || firstDay.precipitation === 0 ? "neutral" : "warning" },
  );
  const grid = <WidgetStatGrid columns={wide ? 3 : 2} className="weather-widget__grid">
    {measurements.map(stat => <WidgetStat key={stat.label} {...stat} className="weather-widget__stat" />)}
  </WidgetStatGrid>;
  return <WidgetBody className="weather-widget" reserveNotice noticeClassName="weather-widget__notice" notice={<>
    <WidgetStaleNotice error={error} />
    <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer"
      title={`Updated ${data.observedAt.replace("T", " ")} (${data.timezone})`}>Weather by Open-Meteo</a>
  </>}>
    {detailed ? <WidgetList label="Five-day weather forecast" header={grid} className="weather-widget__forecast"
      empty={data.forecast.length === 0 ? <WidgetState state="empty">Forecast unavailable</WidgetState> : undefined}>
      {data.forecast.map(day => <WidgetListItem key={day.date} title={forecastDate(day.date)}
        secondary={weatherCondition(day.code)} wrapSecondary
        trailing={<WidgetBadge tone={day.precipitation == null || day.precipitation === 0 ? "neutral" : "warning"}>
          {day.precipitation == null ? "Precip —" : `Precip ${Math.round(day.precipitation)}%`}
        </WidgetBadge>}
        leading={<WidgetBadge tone={day.low == null && day.high == null ? "neutral" : "info"} aria-label={`Low ${temperature(day.low, data.imperial)}; high ${temperature(day.high, data.imperial)}`}>{temperature(day.low, data.imperial)} / {temperature(day.high, data.imperial)}</WidgetBadge>} />)}
    </WidgetList> : <WidgetBody scrollLabel="Weather measurements">{grid}</WidgetBody>}
  </WidgetBody>;
}

const FIELDS: Exclude<WidgetConfigField, { type: "password" }>[] = [
  { key: "latitude", label: "Latitude", type: "number", required: true, placeholder: "51.5074", description: "Location latitude from −90 to 90. Use the tile name for your location label." },
  { key: "longitude", label: "Longitude", type: "number", required: true, placeholder: "-0.1278", description: "Location longitude from −180 to 180." },
  { key: "imperial", label: "Use imperial units", type: "boolean", defaultValue: false, description: "Fahrenheit and mph; otherwise Celsius and km/h." },
];

registerWidget<WeatherConfig, WeatherData>({
  id: "weather", name: "Weather", integrationType: null, configSchema: WeatherConfigSchema,
  component: WeatherWidget,
  fetchData: fetchWeather, refreshInterval: 600_000, preferredSize: "normal", compactHeader: true, sharedUI: true, hasLinks: true,
  supportedFootprints: [
    { label: "Compact", columnSpan: 3, rowSpan: 2 },
    { label: "Wide", columnSpan: 6, rowSpan: 2 },
    { label: "Detailed", columnSpan: 6, rowSpan: 4 },
  ],
  configFields: FIELDS, optionFields: FIELDS,
  serviceEditorPreset: { defaultName: "Weather", defaultIconUrl: "mdi-weather-partly-cloudy" },
});
