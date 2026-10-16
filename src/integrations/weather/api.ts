import { z } from "zod";
import { WidgetFetchError } from "@/widgets/publicFetchError";

export const WeatherConfigSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  imperial: z.boolean().default(false),
});
export type WeatherConfig = z.infer<typeof WeatherConfigSchema>;

const measurement = z.number().finite().nullish().catch(null);
const probability = z.number().finite().min(0).max(100).nullish().catch(null);
const code = z.number().int().nonnegative().nullish().catch(null);
const ResponseSchema = z.object({
  timezone: z.string().min(1),
  current_units: z.object({ temperature_2m: z.enum(["°C", "°F"]), wind_speed_10m: z.enum(["km/h", "mp/h"]) }),
  current: z.object({
    time: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    temperature_2m: measurement, apparent_temperature: measurement,
    relative_humidity_2m: probability, wind_speed_10m: z.number().finite().nonnegative().nullish().catch(null),
    weather_code: code, is_day: z.union([z.literal(0), z.literal(1)]).nullish().catch(null),
  }),
  daily: z.object({
    time: z.array(z.iso.date()),
    weather_code: z.array(code).optional(),
    temperature_2m_max: z.array(measurement).optional(),
    temperature_2m_min: z.array(measurement).optional(),
    precipitation_probability_max: z.array(probability).optional(),
  }).nullish().catch(null),
});

export interface ForecastDay {
  date: string; code: number | null; high: number | null; low: number | null; precipitation: number | null;
}
export interface WeatherData {
  temperature: number | null; feelsLike: number | null; humidity: number | null;
  wind: number | null; code: number | null; isDay: boolean | null;
  observedAt: string; timezone: string; imperial: boolean; forecast: ForecastDay[];
}

/** Fixed public endpoint: coordinates never become a user-controlled destination. */
export async function fetchWeather(input: WeatherConfig, signal?: AbortSignal): Promise<WeatherData> {
  const config = WeatherConfigSchema.parse(input);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(config.latitude), longitude: String(config.longitude), timezone: "auto", forecast_days: "5",
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    temperature_unit: config.imperial ? "fahrenheit" : "celsius",
    wind_speed_unit: config.imperial ? "mph" : "kmh",
  }).toString();
  let response: Response;
  try {
    response = await fetch(url.toString(), { signal, cache: "no-store", redirect: "error" });
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    throw new WidgetFetchError("widget_upstream_unreachable", { integration: "weather", stage: "fetch", retryable: true });
  }
  if (!response.ok) throw new WidgetFetchError("widget_upstream_error", {
    integration: "weather", stage: "http", upstreamStatus: response.status,
    retryable: response.status === 429 || response.status >= 500,
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    throw new WidgetFetchError("widget_invalid_json", { integration: "weather", stage: "json", retryable: false });
  }
  const parsed = ResponseSchema.safeParse(payload);
  if (!parsed.success) throw new WidgetFetchError("widget_invalid_response", { integration: "weather", stage: "schema", retryable: false });
  const raw = parsed.data;
  if (raw.current_units.temperature_2m !== (config.imperial ? "°F" : "°C") ||
    raw.current_units.wind_speed_10m !== (config.imperial ? "mp/h" : "km/h")) {
    throw new WidgetFetchError("widget_invalid_response", { integration: "weather", stage: "units", retryable: false });
  }
  return {
    temperature: raw.current.temperature_2m ?? null, feelsLike: raw.current.apparent_temperature ?? null,
    humidity: raw.current.relative_humidity_2m ?? null, wind: raw.current.wind_speed_10m ?? null,
    code: raw.current.weather_code ?? null, isDay: raw.current.is_day == null ? null : raw.current.is_day === 1,
    observedAt: raw.current.time, timezone: raw.timezone, imperial: config.imperial,
    forecast: (raw.daily?.time ?? []).slice(0, 5).map((date, i) => ({
      date, code: raw.daily?.weather_code?.[i] ?? null, high: raw.daily?.temperature_2m_max?.[i] ?? null,
      low: raw.daily?.temperature_2m_min?.[i] ?? null, precipitation: raw.daily?.precipitation_probability_max?.[i] ?? null,
    })),
  };
}
