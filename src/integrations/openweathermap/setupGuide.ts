import type { WidgetSetupGuide } from "@/widgets";

export const openWeatherMapSetupGuide: WidgetSetupGuide = {
  title: "Set up OpenWeatherMap",
  summary: "Current weather and a forecast from your OpenWeatherMap account, using the shared Weather layouts.",
  requirement: "Kokpit’s server needs HTTPS access to api.openweathermap.org and an active API key with Current Weather and 5 Day / 3 Hour Forecast access. Provider plan terms and quotas apply. One Call subscriptions are not used.",
  steps: [
    { title: "Create and activate an API key", description: "Sign in to OpenWeather and open My API keys. Copy a key with Current Weather and 5 Day / 3 Hour Forecast access. Allow time for a newly created key to activate and check your plan’s quotas. Paste the key into API key and enter https://api.openweathermap.org in API base URL unless you deliberately use a compatible proxy." },
    { title: "Choose a saved location", description: "Enter separate numeric Latitude (−90…90) and Longitude (−180…180), or click Use my location and grant browser/device permission over HTTPS or localhost. Review detected coordinates before saving. Zero is valid; south/west are negative. All viewers use the saved location. The tile name and launch URL do not look up a city." },
    { title: "Choose units and layout", description: "Use imperial units selects Fahrenheit and mph; otherwise Celsius and km/h. Compact shows temperature and conditions; Wide adds Feels like; Detailed adds humidity, wind and a scrolling forecast. Each fetch makes two API calls even for Compact. Leave Refresh interval empty for ten minutes; more viewers, tiles, tests or shorter intervals increase quota use." },
    { title: "Test and save", description: "Test sends the draft coordinates and key to the configured API server. Save the form and finish the dashboard save flow. The key is stored in settings.yaml and replaced with an opaque reference in browser settings responses; keep that file private. Changing the API base URL requires re-entering the key. A failed refresh retains previously loaded data with a warning." },
  ],
  troubleshooting: [
    { title: "Key rejected or request limit reached", description: "For 401/403, check the key, activation and access to both APIs. For 429, check your plan’s quota and reduce tests or increase the refresh interval. Kokpit does not call One Call or automatically subscribe to a paid plan. Check server DNS/HTTPS, proxy and trusted certificates for connectivity failures. Redirects are blocked; configure the final API base URL." },
    { title: "Forecast dates and values differ from daily forecasts", description: "The five-day endpoint returns three-hour samples. Kokpit groups them by the returned location’s UTC offset and shows up to five dates, skipping past dates. Low/high and precipitation probability are minimum/maximum values across available samples, not full-day predictions or rainfall amounts. Conditions use the sample closest to local noon. First and last days can be partial, and the fixed UTC offset does not model future daylight-saving transitions. Hover attribution for the current observation time and offset. Missing measurements display — and unknown condition IDs display Unknown." },
  ],
  documentationUrl: "https://openweathermap.org/forecast5",
};
