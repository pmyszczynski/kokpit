import type { WidgetSetupGuide } from "@/widgets";

export const weatherSetupGuide: WidgetSetupGuide = {
  title: "Set up Weather",
  summary: "Show conditions and a five-day forecast for one saved location using Open-Meteo. No account or API key is needed by this provider.",
  requirement: "Kokpit’s server needs HTTPS access to api.open-meteo.com. The public API’s non-commercial-use terms and request limits apply. Location detection is optional and needs HTTPS/localhost plus browser and device permission; manual coordinates work without it.",
  steps: [
    {
      title: "Choose the place and tile name",
      description: "Select Weather and name the tile for the place, for example London weather. The Name is only a label: typing a city there does not find its coordinates. Leave the optional launch URL empty unless you want the header to open a website; it does not choose the weather provider.",
    },
    {
      title: "Enter latitude and longitude",
      description: "On the linked Open-Meteo forecast page, use the location search to select your place, then copy its Latitude and Longitude into the matching fields here. Enter decimal degrees separately, for example 51.5074 and -0.1278 for London. Use a minus sign for south/west. Latitude accepts -90 to 90; Longitude accepts -180 to 180. Both are required for weather data; zero is valid.",
    },
    {
      title: "Or use this device’s location once",
      description: "Click Use my location and allow location in the browser’s site settings and your device’s Location Services. Finding a position can take up to a minute after permission is granted. Review the filled coordinates before saving; detection rounds them to three decimal places. Cancel location detection stops waiting. All viewers use this tile’s saved place; it does not follow each viewer or track movement.",
    },
    {
      title: "Choose units, footprint and refresh",
      description: "Leave Use imperial units off for Celsius and km/h, or enable it for Fahrenheit and mph. Compact shows temperature/conditions; Wide adds Feels like; Detailed adds humidity, wind, dated precipitation probability and the forecast list. Leave Refresh interval empty for 600,000 ms (ten minutes). Each open tile polls independently, so shorter intervals and more viewers increase requests.",
    },
    {
      title: "Test, review and save",
      description: "Test when enabled, then save the form and finish the normal dashboard save flow; otherwise save and inspect the tile. Test sends the draft coordinates to Open-Meteo before saving. Saved coordinates are sent for later weather fetches. Check that the place, units and forecast look right. Current conditions remain visible with a warning if a later refresh fails.",
    },
  ],
  troubleshooting: [
    {
      title: "Wrong place or invalid coordinates",
      description: "Check field order, decimal points and minus signs. Use numeric decimal degrees, not a city, address, compass letters or degrees/minutes/seconds. Do not paste a pair into one field. The tile name and launch URL do not change the location. Manual entries keep the precision you enter; only browser-detected coordinates are rounded. You can use a nearby town’s coordinates instead of a precise home position.",
    },
    {
      title: "Location permission denied, unavailable or timing out",
      description: "Detection uses the device running this browser, not the Kokpit server. An ordinary HTTP LAN address cannot use detection; use HTTPS or enter coordinates manually. Allow the site and your browser in the operating system’s Location Services; Windows can show a separate browser/system prompt. Permission-prompt time does not count toward the one-minute acquisition timeout, and a recent cached position may be used. Cancel/retry or enter coordinates manually if no position is available. Failed detection keeps your existing coordinates.",
    },
    {
      title: "Weather unavailable, a refresh warning or rate limiting",
      description: "Location detection succeeding does not prove Kokpit’s server can reach Open-Meteo. Check its outbound DNS/HTTPS access, proxy and trusted certificates. Open-Meteo errors or request limits can interrupt updates; keep the ten-minute default or increase it rather than repeatedly testing. Browser tiles and viewers do not share one combined poll. The free API has usage limits and non-commercial-use terms; this widget has no paid-customer endpoint or API-key option.",
    },
    {
      title: "Forecast dates, precipitation or missing values",
      description: "Kokpit asks Open-Meteo to select the timezone from the coordinates and requests five forecast days starting with the location’s current day. Detailed shows daily low/high, daily conditions and maximum precipitation probability, not rainfall amount. Current conditions come from forecast models, not a sensor at your home. Hover the Open-Meteo attribution to see the returned current-data time and timezone. Missing measurements show —, unknown conditions show Unknown, and missing forecast data can leave current conditions available. A successful test does not guarantee every optional measurement is present.",
    },
  ],
  documentationUrl: "https://open-meteo.com/en/docs",
};
