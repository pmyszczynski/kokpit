import { z } from "zod";
import { WeatherConfigSchema, type WeatherData } from "../weather/api";
import { parseHttpUrl } from "../shared/httpUrl";

export const OpenWeatherMapConnectionSchema = z.object({
  url: z.string().trim().min(1).max(2048).refine(value => {
    const url = parseHttpUrl(value, { allowFragment: false });
    return url !== null && !url.search && !value.includes("?");
  }, "Enter an HTTP(S) API base URL without credentials, query or fragment"),
  api_key: z.string().trim().min(1).max(4096),
});
export const OpenWeatherMapConfigSchema = OpenWeatherMapConnectionSchema.extend(WeatherConfigSchema.shape);
export type OpenWeatherMapConfig = z.input<typeof OpenWeatherMapConfigSchema>;

/** Keep credential-bearing provider requests in the server runtime. */
export async function fetchOpenWeatherMap(config: OpenWeatherMapConfig, signal?: AbortSignal): Promise<WeatherData> {
  if (typeof window === "undefined") {
    const { fetchForecast } = await import("./server");
    return fetchForecast(config, signal);
  }
  throw new Error("OpenWeatherMap data is fetched server-side");
}
