import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import { DockerConfigSchema, fetchDockerData } from "./api";
import type { DockerConfig, DockerData } from "./api";

function stateModifier(state: string): string {
  if (state === "running") return "docker-widget__dot--running";
  if (state === "paused" || state === "restarting")
    return "docker-widget__dot--warning";
  return "docker-widget__dot--stopped";
}

export function DockerWidget({
  data,
  loading,
  error,
  refresh: _refresh,
}: WidgetProps<DockerData>) {
  if (!data) {
    return (
      <div className="docker-widget docker-widget--empty">
        {loading && <span className="docker-widget__hint">Loading&hellip;</span>}
        {error && (
          <span className="docker-widget__hint docker-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="docker-widget" aria-label="Docker containers">
      <div className="docker-widget__summary">
        <span>
          <strong>{data.running}</strong> running
        </span>
        <span className="docker-widget__summary-total">
          {data.total} total
        </span>
      </div>
      {data.containers.length === 0 ? (
        <div className="docker-widget--empty">
          <span className="docker-widget__hint">No running containers</span>
        </div>
      ) : (
        <div className="docker-widget__list">
          {data.containers.map((container) => (
            <div key={container.id} className="docker-widget__row">
              <span
                className={`docker-widget__dot ${stateModifier(container.state)}`}
                title={container.state}
                aria-label={container.state}
              />
              <span className="docker-widget__name" title={container.name}>
                {container.name}
              </span>
              <span className="docker-widget__image" title={container.image}>
                {container.image}
              </span>
              <span className="docker-widget__status" title={container.status}>
                {container.status}
              </span>
            </div>
          ))}
        </div>
      )}
      {error && (
        <span className="docker-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<DockerConfig, DockerData>({
  id: "docker",
  name: "Docker",
  preferredSize: "tall",
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
