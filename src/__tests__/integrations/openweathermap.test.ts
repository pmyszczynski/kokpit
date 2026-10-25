// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { ssrfSafeFetch, SsrfBlockedError } from "@/lib/ssrfGuard";
import { fetchOpenWeatherMap, OpenWeatherMapConfigSchema } from "@/integrations/openweathermap/api";
import { conditionCode } from "@/integrations/openweathermap/server";
import { getIntegration, getWidget } from "@/widgets";
import { splitWidgetConfig } from "@/widgets/configBoundary";
import { toClientSafeSettings, resolveServiceIntegrationSecrets } from "@/widgets/configSecrets";
import { KokpitConfigSchema, widgetIntegrationRequirement } from "@/config/schema";
import "@/integrations/openweathermap/widget";

vi.mock("@/lib/ssrfGuard", () => ({ ssrfSafeFetch: vi.fn(), SsrfBlockedError: class extends Error {} }));
const config = { url: "https://api.openweathermap.org", api_key: "private-key&more", latitude: 0, longitude: -0.1278, imperial: false };
const stamp = (time: string) => Date.parse(time) / 1000;
const current = { dt: stamp("2026-10-16T23:30:00Z"), timezone: 7200,
  main: { temp: -2, feels_like: -5, humidity: 0 }, wind: { speed: 10 }, weather: [{ id: 800, icon: "01n" }] };
const sample = (time: string, low: number | null, high: number | null, pop: number | null, id = 500) => ({
  dt: stamp(time), main: { temp_min: low, temp_max: high }, pop, weather: [{ id }],
});
const forecast = { city: { timezone: 7200 }, list: [
  sample("2026-10-16T18:00:00Z", -100, 100, 1), // past local date
  sample("2026-10-17T09:00:00Z", 2, 4, 0.2, 800),
  sample("2026-10-16T21:00:00Z", -1, 1, 0.1), // past local date
  sample("2026-10-17T00:00:00Z", -2, 1, 0.8, 600),
  sample("2026-10-17T12:00:00Z", 3, 5, 0.3, 804),
  sample("2026-10-17T22:00:00Z", 0, 3, 0, 801),
  sample("2026-10-18T00:00:00Z", null, null, null, 999),
] };
function mock(overrides: Record<string, unknown | Response | Error> = {}) {
  return vi.mocked(ssrfSafeFetch).mockImplementation(async url => {
    const path = new URL(url).pathname.split("/").at(-1)!;
    const payload = Object.hasOwn(overrides, path) ? overrides[path] : path === "weather" ? current : forecast;
    if (payload instanceof Error) throw payload;
    return payload instanceof Response ? payload : Response.json(payload);
  });
}
afterEach(() => vi.resetAllMocks());

describe("OpenWeatherMap", () => {
  it("uses explicit units, encoded API keys, a shared abort signal and protected non-redirecting requests", async () => {
    const fetch = mock(); const signal = new AbortController().signal;
    const data = await fetchOpenWeatherMap(config, signal);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetch.mock.calls) {
      const parsed = new URL(url);
      expect(parsed.origin).toBe(config.url);
      expect(Object.fromEntries(parsed.searchParams)).toEqual({ lat: "0", lon: "-0.1278", appid: config.api_key, units: "metric" });
      expect(options).toMatchObject({ signal, followRedirects: false, allowPrivateNetworks: true });
    }
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["/data/2.5/weather", "/data/2.5/forecast"]);
    expect(data).toMatchObject({ provider: "openweathermap", temperature: -2, feelsLike: -5, humidity: 0, wind: 36,
      code: 0, isDay: false, observedAt: "2026-10-17T01:30", timezone: "UTC+02:00", imperial: false });
    expect(data.forecast).toEqual([
      { date: "2026-10-17", low: -2, high: 5, precipitation: 80, code: 0 },
      { date: "2026-10-18", low: 0, high: 3, precipitation: 0, code: 1000 },
    ]);
    expect(JSON.stringify(data)).not.toContain(config.api_key);
  });
  it("preserves an API proxy prefix, uses Fahrenheit and keeps imperial wind in mph", async () => {
    const fetch = mock();
    expect(await fetchOpenWeatherMap({ ...config, url: "https://proxy.example/owm/", imperial: true })).toMatchObject({ temperature: -2, wind: 10, imperial: true });
    expect(new URL(fetch.mock.calls[0][0]).pathname).toBe("/owm/data/2.5/weather");
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get("units")).toBe("imperial");
  });
  it("uses the location offset instead of the server timezone and limits the result to five dates", async () => {
    mock({ weather: { ...current, timezone: -12600 }, forecast: { city: { timezone: -12600 }, list: Array.from({ length: 7 }, (_, i) => sample(`2026-10-${17 + i}T00:00:00Z`, 0, 0, 0)) } });
    const data = await fetchOpenWeatherMap(config);
    expect(data).toMatchObject({ observedAt: "2026-10-16T20:00", timezone: "UTC−03:30" });
    expect(data.forecast.map(day => day.date)).toEqual(["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"]);
  });
  it("keeps missing/invalid optional readings unavailable and empty forecasts empty", async () => {
    mock({ weather: { ...current, main: { temp: "bad", feels_like: null, humidity: 101 }, wind: { speed: -1 }, weather: [] },
      forecast: { ...forecast, list: [sample("2026-10-18T00:00:00Z", null, null, null, 999)] } });
    expect(await fetchOpenWeatherMap(config)).toMatchObject({ temperature: null, feelsLike: null, humidity: null, wind: null, code: null, isDay: null,
      forecast: [{ date: "2026-10-18", high: null, low: null, precipitation: null, code: 1000 }] });
    mock({ forecast: { ...forecast, list: [] } });
    expect((await fetchOpenWeatherMap(config)).forecast).toEqual([]);
  });
  it.each([200, 232, 300, 321, 500, 511, 602, 800, 804, 999, null])("maps provider condition %s without confusing it with WMO", id => {
    const expected = new Map([[200, 95], [232, 95], [300, 53], [321, 53], [500, 61], [511, 66], [602, 75], [800, 0], [804, 3], [999, 1000], [null, null]]);
    expect(conditionCode(id)).toBe(expected.get(id));
  });
  it.each([[401, "widget_upstream_auth_failed", false], [403, "widget_upstream_auth_failed", false], [429, "widget_upstream_error", true], [503, "widget_upstream_error", true], [302, "widget_upstream_redirect_blocked", false]] as const)("sanitizes HTTP %s", async (status, code, retryable) => {
    mock({ forecast: new Response(config.api_key, { status, headers: { Location: "https://other.example/?key=private" } }) });
    await expect(fetchOpenWeatherMap(config)).rejects.toMatchObject({ code, message: "Widget integration failure", diagnostic: { upstreamStatus: status, retryable } });
    expect(vi.mocked(ssrfSafeFetch)).toHaveBeenCalledTimes(2);
  });
  it("classifies network/SSRF/JSON/schema failures without upstream details", async () => {
    mock({ weather: new Error(config.api_key) });
    await expect(fetchOpenWeatherMap(config)).rejects.toMatchObject({ code: "widget_upstream_unreachable", message: "Widget integration failure" });
    mock({ weather: new SsrfBlockedError("private") });
    await expect(fetchOpenWeatherMap(config)).rejects.toMatchObject({ code: "widget_upstream_access_blocked" });
    mock({ forecast: new Response("not JSON") });
    await expect(fetchOpenWeatherMap(config)).rejects.toMatchObject({ code: "widget_invalid_json" });
    mock({ forecast: { ...forecast, city: { timezone: 100000 } } });
    await expect(fetchOpenWeatherMap(config)).rejects.toMatchObject({ code: "widget_invalid_response" });
  });
  it("bounds declared and streamed bodies", async () => {
    mock({ forecast: new Response("{}", { headers: { "content-length": "1048577" } }) });
    await expect(fetchOpenWeatherMap(config)).rejects.toMatchObject({ code: "widget_invalid_response", diagnostic: { stage: "size" } });
    mock({ forecast: new Response("x".repeat(1048577)) });
    await expect(fetchOpenWeatherMap(config)).rejects.toMatchObject({ code: "widget_invalid_response", diagnostic: { stage: "size" } });
  });
  it("propagates cancellation without starting another request", async () => {
    const controller = new AbortController(); controller.abort(); mock();
    await expect(fetchOpenWeatherMap(config, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(ssrfSafeFetch).not.toHaveBeenCalled();
    mock({ weather: new DOMException("Aborted", "AbortError") });
    await expect(fetchOpenWeatherMap(config)).rejects.toMatchObject({ name: "AbortError" });
  });
  it.each([{ latitude: 91 }, { longitude: -181 }, { api_key: " " }, { url: "https://user:password@example.com" }, { url: "https://example.com?token=secret" }, { url: "file:///tmp/weather" }])("rejects invalid configuration before fetching: %j", async overrides => {
    mock();
    await expect(fetchOpenWeatherMap({ ...config, ...overrides })).rejects.toThrow();
    expect(ssrfSafeFetch).not.toHaveBeenCalled();
  });
  it("defaults metric units and separates protected connections from tile options", () => {
    expect(OpenWeatherMapConfigSchema.parse({ url: config.url, api_key: "key", latitude: 0, longitude: 0 })).toMatchObject({ url: config.url, imperial: false });
    expect(widgetIntegrationRequirement("openweathermap")).toBe("openweathermap");
    expect(getIntegration("openweathermap")).toBeDefined();
    expect(getWidget("openweathermap")?.supportedFootprints).toHaveLength(3);
    expect(splitWidgetConfig("openweathermap", config)).toEqual({ connection: { url: config.url, api_key: config.api_key }, options: { latitude: 0, longitude: -0.1278, imperial: false } });
  });
  it("redacts keys in browser settings, retains them for option edits and rejects destination changes", () => {
    const saved = KokpitConfigSchema.parse({ schema_version: 2, services: [{ id: "10000000-0000-4000-8000-000000000001", name: "Weather", integration: { type: "openweathermap", config: { url: config.url, api_key: config.api_key } } }], service_tiles: [] });
    const safe = toClientSafeSettings(saved);
    expect(JSON.stringify(safe)).not.toContain(config.api_key);
    expect(resolveServiceIntegrationSecrets(safe.services, saved.services)[0].integration?.config.api_key).toBe(config.api_key);
    safe.services[0].integration!.config.url = "https://different.example";
    expect(() => resolveServiceIntegrationSecrets(safe.services, saved.services)).toThrow("scope changed");
  });
});
