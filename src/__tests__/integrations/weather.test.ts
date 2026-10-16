// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWeather, WeatherConfigSchema } from "@/integrations/weather/api";
import { weatherCondition, weatherTone } from "@/integrations/weather/conditions";
import "@/integrations/weather/widget";
import { getWidget } from "@/widgets";
import { splitWidgetConfig } from "@/widgets/configBoundary";

const config = { latitude: 51.5074, longitude: -0.1278, imperial: false };
const response = {
  timezone: "Europe/London", current_units: { temperature_2m: "°C", wind_speed_10m: "km/h" },
  daily_units: { temperature_2m_max: "°C", temperature_2m_min: "°C", precipitation_probability_max: "%" },
  current: { time: "2026-10-16T12:15", temperature_2m: 16.2, apparent_temperature: 15.5,
    relative_humidity_2m: 84, wind_speed_10m: 12.2, weather_code: 2, is_day: 1 },
  daily: { time: ["2026-10-16", "2026-10-17"], weather_code: [61, 3], temperature_2m_min: [9.9, 8.1],
    temperature_2m_max: [16.9, 13.5], precipitation_probability_max: [93, 6] },
};
function mock(body: unknown = response) {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal("fetch", fetch); return fetch;
}
afterEach(() => vi.unstubAllGlobals());

describe("Weather API", () => {
  it("uses one fixed HTTPS endpoint, local timezone and explicit metric units", async () => {
    const fetch = mock(); const signal = new AbortController().signal;
    const data = await fetchWeather(config, signal);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0]; const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(Object.fromEntries(parsed.searchParams)).toMatchObject({ latitude: "51.5074", longitude: "-0.1278", timezone: "auto", forecast_days: "5", temperature_unit: "celsius", wind_speed_unit: "kmh" });
    expect(options).toMatchObject({ signal, redirect: "error", cache: "no-store" });
    expect(data).toMatchObject({ temperature: 16.2, feelsLike: 15.5, humidity: 84, wind: 12.2, code: 2, isDay: true, imperial: false });
    expect(data.forecast[1]).toEqual({ date: "2026-10-17", code: 3, high: 13.5, low: 8.1, precipitation: 6 });
  });
  it("requests Fahrenheit and mph without converting measurements twice", async () => {
    const fetch = mock({ ...response, current_units: { temperature_2m: "°F", wind_speed_10m: "mp/h" }, current: { ...response.current, temperature_2m: 61.2 },
      daily_units: { ...response.daily_units, temperature_2m_max: "°F", temperature_2m_min: "°F" } });
    expect(await fetchWeather({ ...config, imperial: true })).toMatchObject({ temperature: 61.2, imperial: true });
    expect(Object.fromEntries(new URL(fetch.mock.calls[0][0]).searchParams)).toMatchObject({ temperature_unit: "fahrenheit", wind_speed_unit: "mph" });
  });
  it.each([null, "", false, "broken"])("preserves missing/invalid current values as null: %j", async (value) => {
    mock({ ...response, current: { ...response.current, temperature_2m: value, apparent_temperature: value, relative_humidity_2m: value, wind_speed_10m: value, weather_code: value } });
    expect(await fetchWeather(config)).toMatchObject({ temperature: null, feelsLike: null, humidity: null, wind: null, code: null });
  });
  it("retains zero and negative values", async () => {
    mock({ ...response, current: { ...response.current, temperature_2m: -10, relative_humidity_2m: 0, wind_speed_10m: 0, weather_code: 0, is_day: 0 } });
    expect(await fetchWeather(config)).toMatchObject({ temperature: -10, humidity: 0, wind: 0, code: 0, isDay: false });
  });
  it.each([undefined, null, { time: ["bad-date"] }])("keeps current conditions when forecast is unavailable: %j", async daily => {
    mock({ ...response, daily }); const data = await fetchWeather(config);
    expect(data.forecast).toEqual([]); expect(data.temperature).toBe(16.2);
  });
  it("uses null for missing daily array elements, preserving date alignment", async () => {
    mock({ ...response, daily: { time: response.daily.time, temperature_2m_max: [16] } });
    expect((await fetchWeather(config)).forecast).toEqual([
      { date: "2026-10-16", high: 16, low: null, precipitation: null, code: null },
      { date: "2026-10-17", high: null, low: null, precipitation: null, code: null },
    ]);
  });
  it("rejects unexpected units instead of mislabeling temperatures", async () => {
    mock({ ...response, current_units: { temperature_2m: "°F", wind_speed_10m: "km/h" } });
    await expect(fetchWeather(config)).rejects.toMatchObject({ code: "widget_invalid_response", diagnostic: { stage: "units" } });
  });
  it.each([undefined, null, { temperature_2m_max: "°F", temperature_2m_min: "°F", precipitation_probability_max: "mm" }])("preserves current data but suppresses unverifiable daily measurements: %j", async daily_units => {
    mock({ ...response, daily_units }); const data = await fetchWeather(config);
    expect(data.temperature).toBe(16.2);
    expect(data.forecast[0]).toEqual({ date: "2026-10-16", code: 61, high: null, low: null, precipitation: null });
  });
  it("rejects upstream HTTP failures and propagates cancellation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    await expect(fetchWeather(config)).rejects.toMatchObject({ code: "widget_upstream_error", diagnostic: { upstreamStatus: 429, retryable: true } });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")));
    await expect(fetchWeather(config)).rejects.toMatchObject({ name: "AbortError" });
  });
  it("classifies network, JSON and schema failures without exposing upstream text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private upstream detail")));
    await expect(fetchWeather(config)).rejects.toMatchObject({ code: "widget_upstream_unreachable", message: "Widget integration failure" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError("upstream payload"); } }));
    await expect(fetchWeather(config)).rejects.toMatchObject({ code: "widget_invalid_json" });
    mock({ current: {} }); await expect(fetchWeather(config)).rejects.toMatchObject({ code: "widget_invalid_response" });
  });
  it.each([{ latitude: 91 }, { longitude: -181 }, { latitude: "" }, { latitude: "51.5" }, { latitude: null }, { imperial: "false" }])("rejects invalid options: %j", async overrides => {
    const fetch = mock(); await expect(fetchWeather({ ...config, ...overrides } as typeof config)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it("accepts coordinate boundaries and defaults metric units", () => {
    expect(WeatherConfigSchema.parse({ latitude: -90, longitude: 180 })).toEqual({ latitude: -90, longitude: 180, imperial: false });
  });
});

describe("Weather registration and condition mapping", () => {
  it("stores all options on the tile without requiring a service integration", () => {
    const widget = getWidget("weather")!;
    expect(widget.integrationType).toBeNull(); expect(widget.sharedUI).toBe(true);
    expect(widget.refreshInterval).toBe(600_000);
    expect(splitWidgetConfig("weather", config)).toEqual({ connection: {}, options: config });
    expect(widget.supportedFootprints?.map(({ columnSpan, rowSpan }) => `${columnSpan}x${rowSpan}`)).toEqual(["3x2", "6x2", "6x4"]);
  });
  it.each([[0, "Clear"], [45, "Fog"], [65, "Heavy rain"], [75, "Heavy snow"], [95, "Thunderstorm"], [99, "Storm with hail"], [500, "Unknown"], [null, "—"]] as const)("describes WMO %s", (code, expected) => expect(weatherCondition(code)).toBe(expected));
  it("distinguishes clear nights and keeps unknown conditions neutral", () => {
    expect(weatherCondition(0, false)).toBe("Clear night");
    expect(weatherTone(999)).toBe("neutral"); expect(weatherTone(95)).toBe("alert"); expect(weatherTone(61)).toBe("warning");
  });
});
