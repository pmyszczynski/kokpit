const CONDITIONS: Record<number, string> = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Rain showers", 81: "Rain showers", 82: "Heavy showers", 85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Storm with hail", 99: "Storm with hail",
};

export function weatherCondition(code: number | null, isDay: boolean | null = null): string {
  if (code === 0 && isDay === false) return "Clear night";
  return code == null ? "—" : CONDITIONS[code] ?? "Unknown";
}

export function weatherTone(code: number | null): "neutral" | "info" | "warning" | "alert" {
  if (code == null || CONDITIONS[code] === undefined) return "neutral";
  return code >= 95 ? "alert" : code >= 51 ? "warning" : "info";
}
