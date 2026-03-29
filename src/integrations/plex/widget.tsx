import { z } from "zod";
import { registerWidget } from "@/widgets";
import type { WidgetProps } from "@/widgets";
import {
  fetchPlexSessions,
  fetchPlexLibraries,
  SESSION_FIELDS,
  LIBRARY_FIELDS,
} from "./api";
import type { PlexField, PlexData, PlexConfig } from "./api";

const PLEX_FIELDS = [
  "streams",
  "transcodes",
  "lan_streams",
  "remote_streams",
  "users",
  "bandwidth",
  "library_movies",
  "library_shows",
  "library_episodes",
  "library_music",
] as const;

const PlexConfigSchema = z.object({
  url: z.string().url(),
  token: z.string().min(1),
  fields: z
    .array(z.enum(PLEX_FIELDS))
    .min(1)
    .default(["streams", "transcodes"]),
});

const FIELD_LABELS: Record<PlexField, string> = {
  streams: "Streaming",
  transcodes: "Transcoding",
  lan_streams: "LAN",
  remote_streams: "Remote",
  users: "Users",
  bandwidth: "Bandwidth",
  library_movies: "Movies",
  library_shows: "Shows",
  library_episodes: "Episodes",
  library_music: "Music",
};

function formatValue(field: PlexField, value: number): string {
  if (field === "bandwidth") {
    return `${(value / 1000).toFixed(1)} Mbps`;
  }
  return String(value);
}

export function PlexWidget({ data, loading, error }: WidgetProps<PlexData>) {
  if (!data) {
    return (
      <div className="plex-widget plex-widget--empty">
        {loading && (
          <span className="plex-widget__hint">Loading&hellip;</span>
        )}
        {error && (
          <span className="plex-widget__hint plex-widget__hint--error">
            {error}
          </span>
        )}
      </div>
    );
  }

  const entries = Object.entries(data) as [PlexField, number][];

  return (
    <div className="plex-widget" aria-label="Plex stats">
      {entries.map(([field, value]) => (
        <div key={field} className="plex-widget__stat">
          <span className="plex-widget__value">{formatValue(field, value)}</span>
          <span className="plex-widget__label">{FIELD_LABELS[field]}</span>
        </div>
      ))}
      {error && (
        <span className="plex-widget__stale-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

registerWidget<PlexConfig, PlexData>({
  id: "plex",
  name: "Plex",
  configSchema: PlexConfigSchema,
  fetchData: async (config, signal) => {
    const requestedFields = new Set(config.fields);
    const needsSessions = SESSION_FIELDS.some((f) => requestedFields.has(f));
    const needsLibraries = LIBRARY_FIELDS.some((f) => requestedFields.has(f));

    const [sessionData, libraryData] = await Promise.all([
      needsSessions ? fetchPlexSessions(config, signal) : Promise.resolve({}),
      needsLibraries ? fetchPlexLibraries(config, signal) : Promise.resolve({}),
    ]);

    return { ...sessionData, ...libraryData };
  },
  refreshInterval: 10_000,
  component: PlexWidget,
  configFields: [
    {
      key: "url",
      label: "Server URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.10:32400",
    },
    {
      key: "token",
      label: "Token",
      type: "password",
      required: true,
      placeholder: "X-Plex-Token",
      description: "Find your token in Plex Web > Account > XML page",
    },
    {
      key: "fields",
      label: "Display",
      type: "multiselect",
      options: [
        { value: "streams", label: "Streaming" },
        { value: "transcodes", label: "Transcoding" },
        { value: "lan_streams", label: "LAN Streams" },
        { value: "remote_streams", label: "Remote Streams" },
        { value: "users", label: "Users" },
        { value: "bandwidth", label: "Bandwidth" },
        { value: "library_movies", label: "Movies" },
        { value: "library_shows", label: "Shows" },
        { value: "library_episodes", label: "Episodes" },
        { value: "library_music", label: "Music" },
      ],
    },
  ],
});
