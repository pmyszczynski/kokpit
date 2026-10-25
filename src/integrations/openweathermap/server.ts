import { z } from "zod";
import { ssrfSafeFetch, SsrfBlockedError } from "@/lib/ssrfGuard";
import { WidgetFetchError } from "@/widgets/publicFetchError";
import { OpenWeatherMapConfigSchema, type OpenWeatherMapConfig } from "./api";
import type { ForecastDay, WeatherData } from "../weather/api";

const MAX_BYTES = 1024 * 1024;
const Timestamp = z.number().int().min(0).max(253402214400);
const Offset = z.number().int().min(-43200).max(50400);
const Measurement = z.number().finite().nullish().catch(null);
const Condition = z.array(z.object({
  id: z.number().int().nonnegative().nullish().catch(null),
  icon: z.string().nullish().catch(null),
})).max(20).nullish().catch(null);
const Current = z.object({
  dt: Timestamp, timezone: Offset,
  main: z.object({ temp: Measurement, feels_like: Measurement, humidity: z.number().min(0).max(100).nullish().catch(null) }),
  wind: z.object({ speed: z.number().finite().nonnegative().nullish().catch(null) }).nullish().catch(null),
  weather: Condition,
});
const Sample = z.object({
  dt: Timestamp,
  main: z.object({ temp_min: Measurement, temp_max: Measurement }),
  pop: z.number().min(0).max(1).nullish().catch(null),
  weather: Condition,
});
const Forecast = z.object({ city: z.object({ timezone: Offset }), list: z.array(Sample).max(40) });

function failure(code: ConstructorParameters<typeof WidgetFetchError>[0], stage: string, status?: number) {
  return new WidgetFetchError(code, { integration: "openweathermap", stage, upstreamStatus: status,
    retryable: code === "widget_upstream_unreachable" || status === 429 || (status !== undefined && status >= 500) });
}

/** Bounded JSON, no redirects, and no upstream text or credential URL in errors. */
async function request(config: z.output<typeof OpenWeatherMapConfigSchema>, path: string, signal?: AbortSignal): Promise<unknown> {
  const url = new URL(`data/2.5/${path}`, `${config.url.replace(/\/$/, "")}/`);
  url.search = new URLSearchParams({ lat: String(config.latitude), lon: String(config.longitude),
    appid: config.api_key, units: config.imperial ? "imperial" : "metric" }).toString();
  let response: Response;
  try {
    response = await ssrfSafeFetch(url.href, { signal, headers: { Accept: "application/json" }, allowPrivateNetworks: true, followRedirects: false });
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw failure(error instanceof SsrfBlockedError ? "widget_upstream_access_blocked" : "widget_upstream_unreachable", path);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    const code = response.status >= 300 && response.status < 400 ? "widget_upstream_redirect_blocked"
      : response.status === 401 || response.status === 403 ? "widget_upstream_auth_failed" : "widget_upstream_error";
    throw failure(code, path, response.status);
  }
  if (!response.body || Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw failure("widget_invalid_response", "size");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0; let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw failure("widget_invalid_response", "size");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof WidgetFetchError || (error instanceof Error && error.name === "AbortError")) throw error;
    throw failure("widget_upstream_unreachable", "body");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  try { return JSON.parse(text); } catch { throw failure("widget_invalid_json", path); }
}

/** Convert OpenWeather condition IDs into the shared WMO presentation codes. */
export function conditionCode(id: number | null | undefined): number | null {
  if (id == null) return null;
  if (id >= 200 && id <= 232) return 95;
  if (id >= 300 && id <= 321) return 53;
  const codes: Record<number, number> = {
    500: 61, 501: 63, 502: 65, 503: 65, 504: 65, 511: 66,
    520: 80, 521: 81, 522: 82, 531: 82,
    600: 71, 601: 73, 602: 75, 611: 77, 612: 77, 613: 77,
    615: 71, 616: 73, 620: 85, 621: 85, 622: 86,
    701: 45, 711: 45, 721: 45, 741: 45, 800: 0, 801: 1, 802: 2, 803: 3, 804: 3,
  };
  return codes[id] ?? 1000; // Unknown, never accidentally interpret an OWM ID as WMO.
}

function localTime(timestamp: number, offset: number) {
  return new Date((timestamp + offset) * 1000).toISOString().slice(0, 16);
}
function offsetLabel(offset: number) {
  const absolute = Math.abs(offset);
  return `UTC${offset < 0 ? "−" : "+"}${String(Math.floor(absolute / 3600)).padStart(2, "0")}:${String(Math.floor(absolute % 3600 / 60)).padStart(2, "0")}`;
}

/** Summarize available three-hour slots, using the slot nearest local noon for conditions. */
export async function fetchForecast(input: OpenWeatherMapConfig, signal?: AbortSignal): Promise<WeatherData> {
  const config = OpenWeatherMapConfigSchema.parse(input);
  signal?.throwIfAborted();
  const current = Current.safeParse(await request(config, "weather", signal));
  if (!current.success) throw failure("widget_invalid_response", "current");
  const forecast = Forecast.safeParse(await request(config, "forecast", signal));
  if (!forecast.success) throw failure("widget_invalid_response", "forecast");
  const raw = current.data;
  const offset = forecast.data.city.timezone;
  const today = localTime(raw.dt, offset).slice(0, 10);
  const days = new Map<string, { day: ForecastDay; noonDistance: number }>();
  for (const sample of [...forecast.data.list].sort((a, b) => a.dt - b.dt)) {
    const time = localTime(sample.dt, offset);
    const date = time.slice(0, 10);
    if (date < today) continue;
    const distance = Math.abs(Number(time.slice(11, 13)) * 60 + Number(time.slice(14, 16)) - 720);
    const entry = days.get(date) ?? { day: { date, low: null, high: null, precipitation: null, code: null }, noonDistance: Infinity };
    if (sample.main.temp_min != null) entry.day.low = Math.min(entry.day.low ?? Infinity, sample.main.temp_min);
    if (sample.main.temp_max != null) entry.day.high = Math.max(entry.day.high ?? -Infinity, sample.main.temp_max);
    if (sample.pop != null) entry.day.precipitation = Math.max(entry.day.precipitation ?? 0, sample.pop * 100);
    if (distance < entry.noonDistance) {
      entry.day.code = conditionCode(sample.weather?.[0]?.id);
      entry.noonDistance = distance;
    }
    days.set(date, entry);
  }
  const icon = raw.weather?.[0]?.icon;
  return {
    provider: "openweathermap", temperature: raw.main.temp ?? null, feelsLike: raw.main.feels_like ?? null,
    humidity: raw.main.humidity ?? null, wind: raw.wind?.speed == null ? null : raw.wind.speed * (config.imperial ? 1 : 3.6),
    code: conditionCode(raw.weather?.[0]?.id), isDay: icon?.endsWith("d") ? true : icon?.endsWith("n") ? false : null,
    observedAt: localTime(raw.dt, raw.timezone), timezone: offsetLabel(raw.timezone), imperial: config.imperial,
    forecast: [...days.values()].slice(0, 5).map(entry => entry.day),
  };
}
