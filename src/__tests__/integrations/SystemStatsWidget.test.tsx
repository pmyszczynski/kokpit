import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SystemStatsWidget } from "@/integrations/systemstats/widget";
import { getWidget } from "@/widgets";
import type { SystemStatsData } from "@/integrations/systemstats/api";

const noop = () => {};

// Numbers chosen so the formatters produce the exact strings from the spec:
// CPU 12%, Memory "3.2 / 16 GB (20%)", Disk "120 / 500 GB (24%)",
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
    expect(screen.getByText("3.2 / 16 GB")).toBeInTheDocument();
    expect(screen.getByText("(20%)")).toBeInTheDocument();
    // Disk
    expect(screen.getByText("120 / 500 GB")).toBeInTheDocument();
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
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
  });
});

describe("system-stats widget registration", () => {
  it("is registered with a service editor preset", async () => {
    await import("@/integrations");
    const widget = getWidget("system-stats");
    expect(widget).toBeDefined();
    expect(widget!.name).toBe("System Stats");
    expect(widget!.refreshInterval).toBe(10_000);
    expect(widget!.preferredSize).toBe("tall");
    expect(widget!.minSize).toBe("normal");
    expect(widget!.serviceEditorPreset?.defaultName).toBe("System");
  });
});
