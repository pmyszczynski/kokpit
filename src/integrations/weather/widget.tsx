import { registerWidget, type WidgetProps, type WidgetConfigField } from "@/widgets";
import { WidgetBody, WidgetStatGrid, WidgetStat, WidgetList, WidgetListItem, WidgetBadge, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import { fetchWeather, WeatherConfigSchema, type WeatherConfig, type WeatherData } from "./api";
import type { WidgetStatTone } from "@/widgets/ui";
import { weatherCondition, weatherTone } from "./conditions";
import { weatherSetupGuide } from "./setupGuide";
import "./widget.css";

/** Format provider-unit temperatures without converting them a second time. */
function temperature(value: number | null, imperial: boolean) {
  return value == null ? "—" : `${Math.round(value)}°${imperial ? "F" : "C"}`;
}

/** Keep date-only forecasts on their saved day regardless of browser time zone. */
function forecastDate(date: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));
}

/** Shared Compact, Wide and Detailed presentation for both weather providers. */
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
    <a href={data.provider === "openweathermap" ? "https://openweathermap.org/" : "https://open-meteo.com/"} target="_blank" rel="noopener noreferrer"
      title={`Updated ${data.observedAt.replace("T", " ")} (${data.timezone})`}>Weather by {data.provider === "openweathermap" ? "OpenWeatherMap" : "Open-Meteo"}</a>
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

export const WEATHER_FIELDS: Exclude<WidgetConfigField, { type: "password" }>[] = [
  { key: "latitude", label: "Latitude", type: "number", required: true, placeholder: "51.5074", description: "Required decimal degrees, −90 to 90; south is negative and 0 is valid. Enter only latitude here, or use Use my location. The Name labels the tile without looking up a city. Testing or fetching weather sends the coordinates to the selected provider." },
  { key: "longitude", label: "Longitude", type: "number", required: true, placeholder: "-0.1278", description: "Required decimal degrees, −180 to 180; west is negative and 0 is valid. For London use -0.1278 with latitude 51.5074. No compass letters or coordinate pair. All viewers use this tile’s saved location." },
  { key: "imperial", label: "Use imperial units", type: "boolean", defaultValue: false, description: "Off/empty defaults to Celsius and km/h. On uses Fahrenheit (including forecast temperatures) and mph. Humidity and precipitation probability remain percentages." },
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
  configFields: WEATHER_FIELDS, optionFields: WEATHER_FIELDS,
  setupGuide: weatherSetupGuide,
  footprintDescription: "Compact 3×2 shows temperature and conditions. Wide 6×2 adds Feels like. Detailed 6×4 adds humidity, wind, dated precipitation probability and a scrolling five-day forecast with daily low/high, conditions and precipitation probability. Every size fetches the same weather data.",
  serviceEditorPreset: { defaultName: "Weather", defaultIconUrl: "mdi-weather-partly-cloudy" },
});
