import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WeatherWidget } from "@/integrations/weather/widget";
import type { WeatherData } from "@/integrations/weather/api";

const data: WeatherData = { temperature: -3.2, feelsLike: -5.8, humidity: 0, wind: 0, code: 0, isDay: false,
  observedAt: "2026-10-16T23:00", timezone: "Europe/London", imperial: false,
  forecast: [{ date: "2026-10-16", high: 2, low: -5, precipitation: 0, code: 3 }] };
const props = { data, loading: false, error: null, refresh: () => {} };

describe("WeatherWidget", () => {
  it.each([[3, 2, 2], [6, 2, 3], [6, 4, 6]])("uses %s×%s with %s stats", (columnSpan, rowSpan, count) => {
    const { container } = render(<WeatherWidget {...props} footprint={{ columnSpan, rowSpan }} />);
    expect(container.querySelectorAll(".widget-stat")).toHaveLength(count);
    expect(screen.getByText("-3°C")).toBeInTheDocument(); expect(screen.getByText("Clear night")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Weather by Open-Meteo" })).toHaveAttribute("href", "https://open-meteo.com/");
    expect(screen.queryByRole("list", { name: "Five-day weather forecast" }) !== null).toBe(rowSpan === 4);
  });
  it("keeps zero values visible and shows daily lows/highs and rain", () => {
    render(<WeatherWidget {...props} footprint={{ columnSpan: 6, rowSpan: 4 }} />);
    expect(screen.getByText("0 km/h")).toBeInTheDocument();
    expect(screen.getAllByText("0%")).toHaveLength(2);
    expect(screen.getByText("-5°C / 2°C")).toBeInTheDocument(); expect(screen.getByText("Precip 0%")).toBeInTheDocument();
    expect(screen.getByText("Fri, Oct 16")).toBeInTheDocument();
  });
  it("labels imperial values and ranges without conversion", () => {
    render(<WeatherWidget {...props} data={{ ...data, imperial: true, temperature: 72.2, wind: 5 }} footprint={{ columnSpan: 6, rowSpan: 4 }} />);
    expect(screen.getByText("72°F")).toBeInTheDocument(); expect(screen.getByText("5 mph")).toBeInTheDocument();
    expect(screen.getByText("-5°F / 2°F")).toBeInTheDocument();
  });
  it("shows partial measurements as unavailable and retains current stats without a forecast", () => {
    render(<WeatherWidget {...props} data={{ ...data, temperature: null, feelsLike: null, humidity: null, wind: null, code: null, forecast: [] }} footprint={{ columnSpan: 6, rowSpan: 4 }} />);
    expect(screen.getAllByText("—")).toHaveLength(6); expect(screen.getByText("Forecast unavailable")).toBeInTheDocument();
  });
  it("retains data with an accessible stale error", () => {
    render(<WeatherWidget {...props} error="Provider unavailable" />);
    expect(screen.getByText("-3°C")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveAccessibleName("Refresh failed; saved data is shown. Provider unavailable");
  });
  it("keeps missing forecast ranges neutral instead of implying a measurement", () => {
    render(<WeatherWidget {...props} data={{ ...data, forecast: [{ ...data.forecast[0], low: null, high: null }] }} footprint={{ columnSpan: 6, rowSpan: 4 }} />);
    expect(screen.getByText("— / —")).toHaveClass("widget-badge--tone-neutral");
  });
  it.each([[true, null, "status"], [false, "Provider unavailable", "alert"]] as const)("renders initial feedback", (loading, error, role) => {
    render(<WeatherWidget {...props} data={null} loading={loading} error={error} />); expect(screen.getByRole(role)).toBeInTheDocument();
  });
  it("renders an explicit no-data state", () => {
    render(<WeatherWidget {...props} data={null} />); expect(screen.getByText("Weather unavailable")).toBeInTheDocument();
  });
});
