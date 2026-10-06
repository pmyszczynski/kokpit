import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { DockerConfigSchema, fetchDockerData } from "./api";
import type { DockerConfig, DockerData } from "./api";
import { WidgetBody, WidgetList, WidgetListItem, WidgetStatusDot, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import type { WidgetStatusDotTone } from "@/widgets/ui";

function stateTone(state: string): WidgetStatusDotTone {
  if (state === "running") return "positive";
  if (state === "paused" || state === "restarting") return "warning";
  return "neutral";
}

export function DockerWidget({ data, loading, error }: WidgetProps<DockerData>) {
  if (!data) {
    return (
      <WidgetBody centered className="docker-widget docker-widget--empty">
        <WidgetState state={loading ? "loading" : error ? "error" : "empty"}
          className="docker-widget__hint" labelClassName="docker-widget__hint docker-widget__hint--error">
          {loading ? "Loading…" : error}
        </WidgetState>
      </WidgetBody>
    );
  }

  return (
    <WidgetBody className={`docker-widget${data.containers.length === 0 ? " docker-widget--empty" : ""}`}
      aria-label="Docker containers" reserveNotice
      notice={<WidgetStaleNotice error={error} className="docker-widget__stale-error" />}>
      <WidgetList label="Docker containers" listClassName="docker-widget__list"
        summary={{
          primary: <><strong>{data.running}</strong> running</>,
          secondary: `${data.total} total`,
          primaryTone: data.running > 0 ? "positive" : "neutral",
          secondaryTone: "info",
          className: "docker-widget__summary",
          secondaryClassName: "docker-widget__summary-total",
        }}
        empty={data.containers.length === 0 ? <WidgetState state="empty" className="docker-widget__hint">No running containers</WidgetState> : undefined}>
        {data.containers.map(container => {
          const tone = stateTone(container.state);
          const modifier = tone === "positive" ? "running" : tone === "warning" ? "warning" : "stopped";
          return <WidgetListItem key={container.id} className="docker-widget__row"
            title={container.name} titleClassName="docker-widget__name"
            secondary={container.image || undefined} secondaryClassName="docker-widget__image"
            leading={<WidgetStatusDot label={container.state} tone={tone} className={`docker-widget__dot docker-widget__dot--${modifier}`} />}
            trailing={container.status ? <span className="docker-widget__status" title={container.status}>{container.status}</span> : undefined}
            wrapTrailing />;
        })}
      </WidgetList>
    </WidgetBody>
  );
}

registerWidget<DockerConfig, DockerData>({
  id: "docker",
  name: "Docker",
  preferredSize: "tall",
  compactHeader: true,
  sharedUI: true,
  sharedStateClassNames: {
    wrapper: "docker-widget docker-widget--empty",
    loading: "docker-widget__hint",
    error: "docker-widget__hint docker-widget__hint--error",
  },
  supportedFootprints: [{ label: "Default", columnSpan: 3, rowSpan: 4 }],
  minSize: "tall",
  serviceEditorPreset: {
    defaultName: "Docker",
    defaultIconUrl: "https://cdn.simpleicons.org/docker/2496ED",
  },
  configSchema: DockerConfigSchema,
  fetchData: fetchDockerData,
  refreshInterval: 15_000,
  component: DockerWidget,
  configFields: [
    {
      key: "socket_path",
      label: "Socket path",
      type: "text",
      placeholder: "/var/run/docker.sock",
      description:
        "Unix socket path inside the Kokpit container. Leave empty for the default.",
    },
    {
      key: "max_items",
      label: "Max rows",
      type: "number",
      placeholder: "10",
      description: "Containers shown in the list (1–50).",
    },
  ],
});
