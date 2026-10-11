import { z } from "zod";
import type { TileFootprint } from "@/layout/grid";
import { WidgetBody, WidgetStat, WidgetStatGrid, WidgetList, WidgetListItem, WidgetBadge, WidgetBar, WidgetState, WidgetStaleNotice } from "@/widgets/ui";
import type { WidgetBadgeTone } from "@/widgets/ui";
import { registerWidget } from "@/widgets";
import type { WidgetProps, WidgetConfigField } from "@/widgets";
import {
  fetchPlexSessions,
  fetchPlexLibraries,
  SESSION_FIELDS,
  LIBRARY_FIELDS,
} from "./api";
import type { PlexField, PlexData } from "./api";

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
    .optional(),
  size_defaults: z.boolean().optional(),
}).transform(config => ({
  ...config,
  fields: config.fields ?? (config.size_defaults ? undefined : ["streams", "transcodes"] as PlexField[]),
}));

type PlexWidgetConfig = z.infer<typeof PlexConfigSchema>;

export function resolvePlexFields(config: Partial<Pick<PlexWidgetConfig, "fields" | "size_defaults">>, footprint?: TileFootprint): PlexField[] {
  if (config.fields) return config.fields;
  if (!config.size_defaults) return ["streams", "transcodes"];
  if (footprint?.columnSpan === 6 && footprint.rowSpan === 4) return [...PLEX_FIELDS];
  if (footprint?.rowSpan === 4) return [...SESSION_FIELDS];
  return footprint?.columnSpan === 6 ? ["streams", "transcodes", "bandwidth"] : ["streams", "transcodes"];
}

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
    const units = ["Mbps", "Gbps", "Tbps"] as const;
    let amount = value / 1000;
    let unitIndex = 0;
    while (unitIndex < units.length - 1 && Math.round(amount * 10) >= 10_000) {
      amount /= 1000;
      unitIndex += 1;
    }
    return `${amount.toFixed(1)} ${units[unitIndex]}`;
  }
  return String(value);
}

function formatLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}

function playbackTone(state: string): WidgetBadgeTone {
  switch (state.toLowerCase()) {
    case "playing": return "positive";
    case "buffering": return "warning";
    case "error": case "failed": return "alert";
    case "paused": case "stopped": case "unknown": return "neutral";
    default: return "info";
  }
}

export function PlexWidget({ data, loading, error, footprint }: WidgetProps<PlexData>) {
  if (!data) return <WidgetBody centered className="plex-widget plex-widget--empty">
    <WidgetState state={loading ? "loading" : error ? "error" : "empty"}
      className={loading ? "plex-widget__hint" : undefined} labelClassName="plex-widget__hint plex-widget__hint--error">{!loading ? error : undefined}</WidgetState>
  </WidgetBody>;
  const entries = Object.entries(data).filter(([field]) => PLEX_FIELDS.includes(field as PlexField)) as [PlexField, number][];
  const canvas = footprint ?? { columnSpan: 6, rowSpan: 2 };
  const detailed = canvas.columnSpan === 3 && canvas.rowSpan === 4 && data.sessions !== undefined;
  const columns = detailed ? 3 : canvas.columnSpan === 6 ? canvas.rowSpan === 4 ? 4 : 3 : 2;
  const capacity = columns * (canvas.rowSpan === 4 ? 3 : 1);
  const summary = entries.length > 0 && <WidgetStatGrid columns={columns}>
    {entries.map(([field, value]) => <WidgetStat key={field} label={FIELD_LABELS[field]} value={formatValue(field, value)}
      tone={field.startsWith("library_") || field === "bandwidth" ? "info" : value > 0 ? "positive" : "neutral"}
      className="plex-widget__stat" data-field={field}
      valueClassName={`plex-widget__value${field === "bandwidth" ? " plex-widget__value--bandwidth" : ""}`}
      labelClassName="plex-widget__label" />)}
  </WidgetStatGrid>;
  if (detailed) {
    // Large custom selections scroll with the sessions so every selected value
    // stays reachable; the ordinary six-stat summary remains fixed above them.
    const scrollingSummary = entries.length > 6;
    const empty = data.sessions!.length === 0 && <WidgetState state="empty">No active streams</WidgetState>;
    return <WidgetBody className="plex-widget" aria-label="Plex stats" data-footprint="3x4" reserveNotice
      notice={<WidgetStaleNotice error={error} className="plex-widget__stale-error" />}>
      <WidgetList label="Active Plex sessions" listClassName="plex-widget__sessions"
        header={scrollingSummary ? undefined : summary} empty={scrollingSummary ? undefined : empty || undefined}>
        {scrollingSummary && <li aria-label="Plex measurements">{summary}</li>}
        {data.sessions!.map((session, index) => {
          const progress = session.progressPercent === null ? null : Math.round(session.progressPercent);
          const metadata = `${formatLabel(session.mediaType)} · ${formatLabel(session.transcodeDecision)}`;
          const tone = playbackTone(session.state);
          return <WidgetListItem key={`${session.username}:${session.title}:${index}`} className="plex-widget__session"
            title={session.title} titleClassName="plex-widget__title"
            secondary={<><span className="plex-widget__username">{session.username}</span> · <span>{metadata}</span></>}
            secondaryTooltip={`${session.username} · ${metadata}`}
            trailing={<WidgetBadge tone={tone}>{formatLabel(session.state)}</WidgetBadge>}
            wrapTrailing footer={<WidgetBar label={`${session.username} progress`} value={progress} tone={tone}
              valueLabel={progress === null ? "Unknown progress" : `${progress}%`} />} />;
        })}
        {scrollingSummary && empty && <li>{empty}</li>}
      </WidgetList>
    </WidgetBody>;
  }
  return <WidgetBody className="plex-widget" aria-label="Plex stats" data-footprint={`${canvas.columnSpan}x${canvas.rowSpan}`}
    reserveNotice scrollLabel={entries.length > capacity ? "Plex measurements" : undefined}
    contentCentered={entries.length === 0}
    notice={<WidgetStaleNotice error={error} className="plex-widget__stale-error" />}>
    {entries.length === 0 ? <WidgetState state="empty" className="plex-widget__hint">No measurements</WidgetState> :
      summary}
  </WidgetBody>;
}

const PLEX_OPTION_FIELDS: Exclude<WidgetConfigField, { type: "password" }>[] = [
  { key: "size_defaults", label: "Choose default fields by tile size", type: "boolean",
    description: "Default fields use 2/3/6/10 stats by tile size. Turn off for the historical Streaming/Transcoding defaults. Custom Display selections take priority." },
  { key: "fields", label: "Display", type: "multiselect", resetLabel: "Use default fields",
    description: "Choose at least one custom field, or restore the default selection.",
    options: PLEX_FIELDS.map(value => ({ value, label: FIELD_LABELS[value] })) },
];

registerWidget<PlexWidgetConfig, PlexData>({
  id: "plex",
  name: "Plex",
  preferredSize: "normal",
  compactHeader: true,
  sharedUI: true,
  sharedStateClassNames: { wrapper: "plex-widget plex-widget--empty", loading: "plex-widget__hint", error: "plex-widget__hint plex-widget__hint--error" },
  optionFields: PLEX_OPTION_FIELDS,
  supportedFootprints: [
    { label: "Compact", columnSpan: 3, rowSpan: 2 },
    { label: "Wide", columnSpan: 6, rowSpan: 2 },
    { label: "Detailed", columnSpan: 3, rowSpan: 4 },
    { label: "Expanded", columnSpan: 6, rowSpan: 4 },
  ],
  serviceEditorPreset: {
    defaultConfig: { size_defaults: true },
    defaultName: "Plex",
    defaultIconUrl: "https://cdn.simpleicons.org/plex/e5a00d",
  },
  configSchema: PlexConfigSchema,
  fetchData: async (config, signal, context) => {
    const requestConfig = { ...config, fields: resolvePlexFields(config, context?.footprint) };
    const requestedFields = new Set(requestConfig.fields);
    const needsSessions = SESSION_FIELDS.some((f) => requestedFields.has(f));
    const needsLibraries = LIBRARY_FIELDS.some((f) => requestedFields.has(f));
    const includeSessions = context?.footprint.columnSpan === 3 && context.footprint.rowSpan === 4;

    const [sessionData, libraryData] = await Promise.all([
      needsSessions || includeSessions ? fetchPlexSessions(requestConfig, signal, includeSessions) : Promise.resolve({}),
      needsLibraries ? fetchPlexLibraries(requestConfig, signal) : Promise.resolve({}),
    ]);

    return { ...sessionData, ...libraryData };
  },
  refreshInterval: 10_000,
  component: PlexWidget,
  credentialScopeFields: ["url"],
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
    ...PLEX_OPTION_FIELDS,
  ],
});
