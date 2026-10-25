import { registerIntegration, registerWidget, type WidgetConfigField } from "@/widgets";
import { WeatherWidget, WEATHER_FIELDS } from "../weather/widget";
import type { WeatherData } from "../weather/api";
import { fetchOpenWeatherMap, OpenWeatherMapConfigSchema, OpenWeatherMapConnectionSchema, type OpenWeatherMapConfig } from "./api";
import { openWeatherMapSetupGuide } from "./setupGuide";

const CONNECTION: WidgetConfigField[] = [
  { key: "url", label: "API base URL", type: "url", required: true, placeholder: "https://api.openweathermap.org", description: "Enter https://api.openweathermap.org for OpenWeatherMap. A compatible proxy can use its own base URL/prefix. Do not append /data/2.5 or endpoint paths. Redirects are blocked; changing this URL requires re-entering the saved key." },
  { key: "api_key", label: "API key", type: "password", required: true, description: "OpenWeather account → My API keys. The key must have Current Weather and 5 Day / 3 Hour Forecast access; new keys can take time to activate. One Call is not used. The saved key stays server-side." },
];
registerIntegration({ id: "openweathermap", connectionSchema: OpenWeatherMapConnectionSchema, connectionFields: CONNECTION, credentialScopeFields: ["url"] });
registerWidget<OpenWeatherMapConfig, WeatherData>({
  id: "openweathermap", name: "Weather (OpenWeatherMap)", integrationType: "openweathermap", configSchema: OpenWeatherMapConfigSchema,
  fetchData: fetchOpenWeatherMap, component: WeatherWidget, refreshInterval: 600_000, fetchTimeoutMs: 10_000,
  preferredSize: "normal", compactHeader: true, sharedUI: true, hasLinks: true,
  supportedFootprints: [{ label: "Compact", columnSpan: 3, rowSpan: 2 }, { label: "Wide", columnSpan: 6, rowSpan: 2 }, { label: "Detailed", columnSpan: 6, rowSpan: 4 }],
  footprintDescription: "Compact shows temperature and conditions. Wide adds Feels like. Detailed adds humidity, wind and up to five local forecast dates. Forecast lows/highs and maximum precipitation probability summarize available three-hour samples; conditions use the sample nearest local noon. First/last days may be partial. Every size makes the same two API requests.",
  configFields: [...CONNECTION, ...WEATHER_FIELDS], optionFields: WEATHER_FIELDS, credentialScopeFields: ["url"],
  setupGuide: openWeatherMapSetupGuide,
  serviceEditorPreset: { defaultName: "Weather (OpenWeatherMap)", defaultIconUrl: "mdi-weather-partly-cloudy" },
});
