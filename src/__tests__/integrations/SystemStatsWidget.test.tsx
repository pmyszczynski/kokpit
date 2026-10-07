import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SystemStatsWidget } from "@/integrations/systemstats/widget";
import { getWidget } from "@/widgets";
import type { SystemStatsData } from "@/integrations/systemstats/api";

const noop = () => {};

// Numbers chosen so the formatters produce the exact strings from the spec:
// CPU 12%, Memory "3.2 / 16 GiB (20%)", Disk "120 / 500 GiB (24%)",
// Network "↓ 1.2 MB/s" / "↑ 240 KB/s", Load "0.42 0.55 0.60", Docker "8 / 12 running".
const FULL_DATA: SystemStatsData = {
  cpu: { usagePercent: 12.4, cores: 8 },
  memory: {
    total: 16 * 1024 ** 3,
    used: 3435973837, // ~3.2 * 1024^3
    available: 16 * 1024 ** 3 - 3435973837,
    usagePercent: 20,
  },
  disk: {
    path: "/",
    total: 500 * 1024 ** 3,
    used: 120 * 1024 ** 3,
    available: 380 * 1024 ** 3,
    usagePercent: 24,
  },
  network: {
    rxBytesPerSec: 1_200_000,
    txBytesPerSec: 240_000,
    interfaces: ["eth0"],
  },
  load: { one: 0.42, five: 0.55, fifteen: 0.6, cores: 8 },
  docker: { running: 8, total: 12 },
  dockerError: null,
};

const EMPTY_DATA: SystemStatsData = {
  cpu: null,
  memory: null,
  disk: null,
  network: null,
  load: null,
  docker: null,
  dockerError: null,
};

const DOCKER_ERROR_DATA: SystemStatsData = {
  cpu: { usagePercent: 5, cores: 4 },
  memory: null,
  disk: null,
  network: null,
  load: null,
  docker: null,
  dockerError:
    "Docker socket not found at /var/run/docker.sock — is it mounted into the container?",
};

describe("SystemStatsWidget", () => {
  it.each([3, 6])("shows %s-column summary cards with full supporting measurement tooltips", columnSpan => {
    const data = { ...EMPTY_DATA, cpu: FULL_DATA.cpu, memory: FULL_DATA.memory, ...(columnSpan === 6 ? { disk: FULL_DATA.disk } : {}) };
    const { container } = render(<SystemStatsWidget data={data} loading={false} error={null} refresh={noop} footprint={{ columnSpan, rowSpan: 2 }} />);
    expect(container.querySelectorAll(".widget-stat")).toHaveLength(columnSpan === 6 ? 3 : 2);
    expect(screen.getByText("20%")).toHaveAccessibleDescription("3.2 / 16 GiB (20%); 12.8 GiB available");
    expect(screen.getByText("12%")).toBeVisible();
    if (columnSpan === 6) expect(screen.getByText("24%")).toHaveAccessibleDescription("/: 120 / 500 GiB (24%); 380 GiB available");
  });
  it("keeps every custom selected field on a compact canvas", () => {
    const { container } = render(<SystemStatsWidget data={FULL_DATA} loading={false} error={null} refresh={noop} footprint={{ columnSpan: 3, rowSpan: 2 }} />);
    expect(container.querySelectorAll(".widget-stat-row")).toHaveLength(6);
    expect(screen.getByText("8 / 12 running")).toBeVisible();
    expect(screen.getByRole("region", { name: "System stats measurements" })).toHaveAttribute("tabindex", "0");
  });
  it("names usage meters, retains domain values beyond the fill limits and distinguishes transfer directions", () => {
    const data = { ...FULL_DATA, cpu: { ...FULL_DATA.cpu!, usagePercent: 120 }, memory: { ...FULL_DATA.memory!, usagePercent: -5 } };
    render(<SystemStatsWidget data={data} loading={false} error={null} refresh={noop} />);
    expect(screen.getByRole("meter", { name: "CPU usage" })).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("meter", { name: "CPU usage" })).toHaveAttribute("aria-valuetext", "120%");
    expect(screen.getByText("120%")).toBeVisible();
    expect(screen.getByRole("meter", { name: "Memory usage" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByRole("meter", { name: "Memory usage" })).toHaveAttribute("aria-valuetext", "3.2 / 16 GiB (-5%)");
    expect(screen.getByText("↓ 1.2 MB/s")).toHaveClass("widget-stat-row__value--tone-positive");
    expect(screen.getByText("↑ 240 KB/s")).toHaveClass("widget-stat-row__value--tone-info");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
  it("retains an empty saved result on refresh failure without an empty scroll region", () => {
    render(<SystemStatsWidget data={EMPTY_DATA} loading={false} error="Host unavailable" refresh={noop} />);
    expect(screen.getByText("No stats to show")).toBeVisible();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveAccessibleName("Refresh failed; saved data is shown. Host unavailable");
  });
  it("renders only supplied fields, preserves zero readings and isolates a Docker-only error", () => {
    const { rerender, container } = render(<SystemStatsWidget data={{ ...EMPTY_DATA, network: { ...FULL_DATA.network!, rxBytesPerSec: 0, txBytesPerSec: 0 } }} loading={false} error={null} refresh={noop} />);
    expect(container.querySelectorAll(".widget-stat-row")).toHaveLength(1);
    for (const text of ["↓ 0 B/s", "↑ 0 B/s"]) expect(screen.getByText(text)).toHaveClass("widget-stat-row__value--tone-neutral");
    rerender(<SystemStatsWidget data={{ ...EMPTY_DATA, dockerError: "Socket unavailable" }} loading={false} error={null} refresh={noop} />);
    expect(screen.getByText("Docker unavailable")).toHaveAttribute("title", "Socket unavailable");
    expect(container.querySelectorAll(".widget-stat-row")).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("No stats to show")).not.toBeInTheDocument();
  });
  it("shows loading hint when data is null and loading", () => {
    render(<SystemStatsWidget data={null} loading={true} error={null} refresh={noop} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <SystemStatsWidget
        data={null}
        loading={false}
        error="Cannot read /proc/stat — is this a Linux host?"
        refresh={noop}
      />
    );
    expect(screen.getByText(/cannot read \/proc\/stat/i)).toBeInTheDocument();
  });

  it("renders every non-null field with formatted values and percentage bars", () => {
    const { container } = render(
      <SystemStatsWidget data={FULL_DATA} loading={false} error={null} refresh={noop} />
    );

    // CPU
    expect(screen.getByText("12%")).toBeInTheDocument();
    // Memory
    expect(screen.getByText("3.2 / 16 GiB")).toBeInTheDocument();
    expect(screen.getByText("(20%)")).toBeInTheDocument();
    // Disk
    expect(screen.getByText("120 / 500 GiB")).toBeInTheDocument();
    expect(screen.getByText("(24%)")).toBeInTheDocument();
    expect(screen.getByText("Disk (/)")).toBeInTheDocument();
    // Network
    expect(screen.getByText("↓ 1.2 MB/s")).toBeInTheDocument();
    expect(screen.getByText("↑ 240 KB/s")).toBeInTheDocument();
    // Load
    expect(screen.getByText("0.42")).toBeInTheDocument();
    expect(screen.getByText("0.55")).toBeInTheDocument();
    expect(screen.getByText("0.60")).toBeInTheDocument();
    // Docker
    expect(screen.getByText("8 / 12 running")).toBeInTheDocument();

    expect(container.querySelectorAll(".system-stats-widget__bar")).toHaveLength(3);
  });

  it("shows a muted 'Docker unavailable' line when dockerError is set", () => {
    render(
      <SystemStatsWidget data={DOCKER_ERROR_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(screen.getByText("Docker unavailable")).toBeInTheDocument();
    // The successful-docker "running" summary must not render.
    expect(screen.queryByText(/running$/)).not.toBeInTheDocument();
    // Still renders the one field that IS present.
    expect(screen.getByText("5%")).toBeInTheDocument();
  });

  it("shows the empty state when data is present but every field is null", () => {
    const { container } = render(
      <SystemStatsWidget data={EMPTY_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(container.querySelector(".system-stats-widget--empty")).toBeInTheDocument();
    expect(screen.getByText(/no stats/i)).toBeInTheDocument();
  });

  it("shows a stale error alongside data when a refresh fails", () => {
    render(
      <SystemStatsWidget data={FULL_DATA} loading={false} error="refresh failed" refresh={noop} />
    );
    expect(screen.getByText("12%")).toBeInTheDocument();
    expect(screen.getByText("8 / 12 running")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveAccessibleName("Refresh failed; saved data is shown. refresh failed");
  });
});

describe("system-stats widget registration", () => {
  it("is registered with a service editor preset", async () => {
    await import("@/integrations");
    const widget = getWidget("system-stats");
    expect(widget).toBeDefined();
    expect(widget!.name).toBe("System Stats");
    expect(widget!.refreshInterval).toBe(10_000);
    expect(widget!.preferredSize).toBe("normal");
    expect(widget!.minSize).toBe("normal");
    expect(widget!.supportedFootprints).toEqual([
      { label: "Compact", columnSpan: 3, rowSpan: 2 },
      { label: "Detailed", columnSpan: 3, rowSpan: 4 },
      { label: "Wide", columnSpan: 6, rowSpan: 2 },
    ]);
    expect(widget!.serviceEditorPreset?.defaultConfig).toEqual({ size_defaults: true });
    expect(widget!.compactHeader).toBe(true);
    expect(widget!.sharedUI).toBe(true);
    expect(widget!.serviceEditorPreset?.defaultName).toBe("System");
  });
});
