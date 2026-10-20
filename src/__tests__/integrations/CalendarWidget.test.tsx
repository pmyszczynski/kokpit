import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CalendarWidget } from "@/integrations/calendar/widget";
import type { CalendarData } from "@/integrations/calendar/api";
const data: CalendarData = { timezone: "Europe/Warsaw", daysAhead: 7, events: [
  { id: "one", title: "Planning", start: "2026-10-20T09:00:00Z", end: "2026-10-20T10:00:00Z", allDay: false, description: "Bring your ideas", location: "Studio", url: "https://example.com/event", tentative: false, ongoing: false },
  { id: "two", title: "Dinner", start: "2026-10-21T16:00:00Z", end: "2026-10-21T17:00:00Z", allDay: false, description: "Table by the window", location: "Cafe", url: "https://example.com/dinner", tentative: false, ongoing: false },
] };
const props = { loading: false, error: null, refresh: () => {}, data };
describe("Calendar shared UI", () => {
  it.each([3, 6])("retains all events with native links at %s columns", columns => {
    render(<CalendarWidget {...props} footprint={{ columnSpan: columns, rowSpan: 4 }} />);
    expect(within(screen.getByRole("list", { name: "Upcoming calendar events" })).getAllByRole("listitem")).toHaveLength(data.events.length);
    expect(screen.getByRole("link", { name: "Planning" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByRole("link", { name: "Dinner" })).toHaveAttribute("href", "https://example.com/dinner");
    expect(screen.getByText(columns === 6 ? "11:00–12:00 · Studio" : "11:00–12:00")).toBeInTheDocument();
    expect(screen.queryByText("Bring your ideas") !== null).toBe(columns === 6);
  });
  it("preserves all-day dates and shows the inclusive final day", () => {
    render(<CalendarWidget {...props} data={{ ...data, timezone: "Pacific/Kiritimati", events: [{ ...data.events[0], allDay: true, start: "2026-10-20", end: "2026-10-23" }] }} />);
    expect(screen.getByText("Oct 20")).toBeInTheDocument(); expect(screen.getByText("All day · through Oct 22")).toBeInTheDocument();
  });
  it("keeps an explicit empty state and reserved stale notice", () => {
    const { container } = render(<CalendarWidget {...props} data={{ ...data, events: [] }} error="Calendar provider unavailable" />);
    expect(screen.getByText("No upcoming events")).toBeInTheDocument(); expect(screen.getByRole("alert")).toHaveAttribute("title", "Calendar provider unavailable");
    expect(container.querySelector(".widget-body__notice")).toBeInTheDocument();
  });
  it("does not create unsafe event links", () => {
    render(<CalendarWidget {...props} data={{ ...data, events: [{ ...data.events[0], url: "javascript:alert(1)" }] }} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("retains fragments on safe event links", () => {
    render(<CalendarWidget {...props} data={{ ...data, events: [{ ...data.events[0], url: "https://example.com/event#details" }] }} />);
    expect(screen.getByRole("link", { name: "Planning" })).toHaveAttribute("href", "https://example.com/event#details");
  });
  it("uses the same month/day order and 24-hour time for cross-day event ends", () => {
    render(<CalendarWidget {...props} data={{ ...data, events: [{ ...data.events[0], start: "2026-10-20T21:00:00Z", end: "2026-10-21T07:00:00Z" }] }} />);
    expect(screen.getByText("23:00–Oct 21, 09:00")).toBeInTheDocument();
  });
});
