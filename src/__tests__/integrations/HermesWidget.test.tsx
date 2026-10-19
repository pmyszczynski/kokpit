import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HermesWidget } from "@/integrations/hermes/widget";
import type { HermesData } from "@/integrations/hermes/api";

const data: HermesData = { health: "ready", activeApiRuns: 2, jobsState: "available", scheduledJobs: 3, failedJobs: 1, nextJob: { name: "Daily homelab report", nextRun: "2026-10-20T12:00:00Z", lastStatus: "ok" }, sessionsState: "available", sessions: [{ id: "session", title: "Check backups", source: "telegram", lastActive: "2026-10-20T11:00:00Z" }] };
const props = { data, loading: false, error: null, refresh: () => {} };
describe("HermesWidget", () => {
  it.each([[3, 4], [6, 3]])("shows health, API activity, next job and recent sessions at %s×%s", (columnSpan, rowSpan) => {
    render(<HermesWidget {...props} footprint={{ columnSpan, rowSpan }} />);
    expect(screen.getByText("Ready")).toBeInTheDocument(); expect(screen.getByText("2 API runs")).toBeInTheDocument();
    expect(screen.getByText("3 scheduled")).toBeInTheDocument(); expect(screen.getByText("1 failed job")).toBeInTheDocument();
    expect(screen.getByText("Daily homelab report")).toHaveAttribute("title", "Daily homelab report");
    expect(screen.getByText(/Next job · Oct 20, 2026, 12:00 PM UTC/)).toBeInTheDocument();
    expect(screen.getByText("Check backups")).toBeInTheDocument(); expect(screen.getByText(/telegram · Oct 20/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Hermes activity" })).toHaveAttribute("tabindex", "0");
  });
  it("distinguishes unsupported, unavailable and missing data from zero or empty", () => {
    render(<HermesWidget {...props} data={{ ...data, health: "online", activeApiRuns: null, jobsState: "unsupported", scheduledJobs: null, failedJobs: null, nextJob: null, sessionsState: "unavailable", sessions: [] }} />);
    expect(screen.getByText("Online")).toBeInTheDocument(); expect(screen.getByText("API runs: —")).toBeInTheDocument();
    expect(screen.getByText("Scheduled jobs not supported by this Hermes version")).toBeInTheDocument(); expect(screen.getByText("Recent sessions unavailable")).toBeInTheDocument();
    expect(screen.queryByText("0 scheduled")).not.toBeInTheDocument();
  });
  it("keeps zero activity and empty sections explicit", () => {
    render(<HermesWidget {...props} data={{ ...data, activeApiRuns: 0, scheduledJobs: 0, failedJobs: 0, nextJob: null, sessions: [] }} />);
    for (const label of ["0 API runs", "0 scheduled", "0 failed jobs", "No scheduled jobs", "No recent sessions"]) expect(screen.getByText(label)).toBeInTheDocument();
  });
  it("retains metadata and a reserved stale notice on refresh failure", () => {
    render(<HermesWidget {...props} error="Hermes unreachable" />);
    expect(screen.getByRole("alert")).toHaveAccessibleName("Refresh failed; saved data is shown. Hermes unreachable"); expect(screen.getByText("Check backups")).toBeInTheDocument();
  });
  it("renders metadata as plain text without trusting remote markup", () => {
    const { container } = render(<HermesWidget {...props} data={{ ...data, sessions: [{ ...data.sessions[0], title: "<script>bad()</script>", lastActive: null }] }} />);
    expect(container.querySelector("script")).toBeNull(); expect(screen.getByText("<script>bad()</script>")).toBeInTheDocument(); expect(screen.getByText(/Time unavailable/)).toBeInTheDocument();
  });
  it.each([[true, null, "status"], [false, "Hermes offline", "alert"]] as const)("uses shared initial feedback", (loading, error, role) => {
    render(<HermesWidget {...props} data={null} loading={loading} error={error} />); expect(screen.getByRole(role)).toBeInTheDocument();
  });
});
