import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DockerWidget } from "@/integrations/docker/widget";
import { getWidget } from "@/widgets";
import type { DockerData } from "@/integrations/docker/api";

const noop = () => {};

const SAMPLE_DATA: DockerData = {
  running: 2,
  total: 4,
  containers: [
    {
      id: "a2857bd83583",
      name: "kokpit",
      image: "ghcr.io/pmyszczynski/kokpit:latest",
      state: "running",
      status: "Up 2 hours",
    },
    {
      id: "b1946ac92492",
      name: "plex",
      image: "linuxserver/plex:latest",
      state: "running",
      status: "Up 3 days",
    },
    {
      id: "d4a79df05705",
      name: "adguard",
      image: "adguard/adguardhome",
      state: "paused",
      status: "Up 1 day (Paused)",
    },
  ],
};

describe("DockerWidget", () => {
  it("shows loading hint when data is null and loading", () => {
    render(<DockerWidget data={null} loading={true} error={null} refresh={noop} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <DockerWidget
        data={null}
        loading={false}
        error="Docker socket not found at /var/run/docker.sock — is it mounted into the container?"
        refresh={noop}
      />
    );
    expect(screen.getByText(/socket not found/i)).toBeInTheDocument();
  });

  it("renders the running/total summary", () => {
    render(<DockerWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("4 total")).toBeInTheDocument();
  });

  it("renders a row per container with name, image, and status", () => {
    render(<DockerWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />);
    expect(screen.getByText("kokpit")).toBeInTheDocument();
    expect(screen.getByText("plex")).toBeInTheDocument();
    expect(screen.getByText("linuxserver/plex:latest")).toBeInTheDocument();
    expect(screen.getByText("Up 3 days")).toBeInTheDocument();
  });

  it("marks running and paused containers with different state dots", () => {
    const { container } = render(
      <DockerWidget data={SAMPLE_DATA} loading={false} error={null} refresh={noop} />
    );
    expect(container.querySelectorAll(".docker-widget__dot--running")).toHaveLength(2);
    expect(container.querySelectorAll(".docker-widget__dot--warning")).toHaveLength(1);
  });

  it("shows 'No running containers' when the list is empty", () => {
    render(
      <DockerWidget
        data={{ running: 0, total: 3, containers: [] }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("No running containers")).toBeInTheDocument();
    expect(screen.getByText("3 total")).toBeInTheDocument();
  });

  it("shows a stale error alongside data when a refresh fails", () => {
    render(
      <DockerWidget data={SAMPLE_DATA} loading={false} error="refresh failed" refresh={noop} />
    );
    expect(screen.getByText("kokpit")).toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
  });
});

describe("docker widget registration", () => {
  it("is registered with a service editor preset", async () => {
    await import("@/integrations");
    const widget = getWidget("docker");
    expect(widget).toBeDefined();
    expect(widget!.name).toBe("Docker");
    expect(widget!.refreshInterval).toBe(15_000);
    expect(widget!.serviceEditorPreset?.defaultName).toBe("Docker");
  });
});
