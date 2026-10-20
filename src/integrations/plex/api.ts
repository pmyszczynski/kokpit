import { credentialFetch } from "@/integrations/shared/credentialFetch";
export type PlexField =
  | "streams"
  | "transcodes"
  | "lan_streams"
  | "remote_streams"
  | "users"
  | "bandwidth"
  | "library_movies"
  | "library_shows"
  | "library_episodes"
  | "library_music";

export interface PlexPlaybackSession {
  username: string;
  title: string;
  state: string;
  mediaType: string;
  transcodeDecision: string;
  progressPercent: number | null;
}

export type PlexData = Partial<Record<PlexField, number>> & {
  sessions?: PlexPlaybackSession[];
};

export interface PlexConfig {
  url: string;
  token: string;
  fields: PlexField[];
}

interface PlexSessionMetadata {
  type?: string;
  title?: string;
  parentTitle?: string;
  grandparentTitle?: string;
  parentIndex?: number;
  index?: number;
  duration?: number | string;
  viewOffset?: number | string;
  Player?: { state?: string };
  Media?: Array<{ videoDecision?: string; audioDecision?: string; Part?: Array<{ decision?: string }> }>;
  TranscodeSession?: { videoDecision?: string; audioDecision?: string };
  Session?: { location?: string; bandwidth?: number };
  User?: { title?: string };
}

interface PlexSessionsResponse {
  MediaContainer: {
    size: number;
    Metadata?: PlexSessionMetadata[];
  };
}

interface PlexSectionEntry {
  key: string;
  type: string;
}

const SESSION_FIELDS: PlexField[] = [
  "streams",
  "transcodes",
  "lan_streams",
  "remote_streams",
  "users",
  "bandwidth",
];

const LIBRARY_FIELDS: PlexField[] = [
  "library_movies",
  "library_shows",
  "library_episodes",
  "library_music",
];

function plexBase(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Project only display fields; never forward Plex player/device or media paths. */
function playbackSession(entry: PlexSessionMetadata): PlexPlaybackSession {
  const mediaType = textOr(entry.type, "unknown");
  let title = textOr(entry.title, "Untitled");
  if (mediaType === "episode") {
    const season = finiteNumber(entry.parentIndex), episode = finiteNumber(entry.index);
    const numbering = season !== null && episode !== null
      ? `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`
      : undefined;
    title = [textOr(entry.grandparentTitle, ""), numbering, title].filter(Boolean).join(" · ");
  } else if (mediaType === "track") {
    title = [textOr(entry.grandparentTitle, ""), textOr(entry.parentTitle, ""), title].filter(Boolean).join(" · ");
  }
  const decisions = [entry.TranscodeSession?.videoDecision, entry.TranscodeSession?.audioDecision,
    ...(entry.Media ?? []).flatMap(media => [media.videoDecision, media.audioDecision, ...(media.Part ?? []).map(part => part.decision)])];
  const transcodeDecision = decisions.includes("transcode") ? "transcode"
    : decisions.includes("copy") ? "direct_stream"
    : decisions.includes("directplay") ? "direct_play"
    : entry.TranscodeSession ? "transcode" : "direct_play";
  const duration = finiteNumber(entry.duration), offset = finiteNumber(entry.viewOffset);
  return {
    username: textOr(entry.User?.title, "Unknown user"), title,
    state: textOr(entry.Player?.state, "unknown"), mediaType, transcodeDecision,
    progressPercent: duration !== null && duration > 0 && offset !== null
      ? Math.min(100, Math.max(0, offset / duration * 100)) : null,
  };
}

export async function fetchPlexSessions(
  config: PlexConfig,
  signal?: AbortSignal,
  includeSessions = false
): Promise<PlexData> {
  const url = new URL("status/sessions", plexBase(config.url));
  url.searchParams.set("X-Plex-Token", config.token);

  const response = await credentialFetch(config.url, url.toString(), {
    signal,
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Plex responded with ${response.status}`);
  }

  const json = (await response.json()) as PlexSessionsResponse;
  const metadata = json.MediaContainer.Metadata ?? [];
  const result: PlexData = {};

  const requested = new Set(config.fields);

  if (requested.has("streams")) {
    result.streams = json.MediaContainer.size;
  }
  if (requested.has("transcodes")) {
    result.transcodes = metadata.filter((e) => "TranscodeSession" in e).length;
  }
  if (requested.has("lan_streams")) {
    result.lan_streams = metadata.filter(
      (e) => e.Session?.location === "lan"
    ).length;
  }
  if (requested.has("remote_streams")) {
    result.remote_streams = metadata.filter(
      (e) => e.Session?.location === "wan"
    ).length;
  }
  if (requested.has("users")) {
    const names = new Set(metadata.map((e) => e.User?.title).filter(Boolean));
    result.users = names.size;
  }
  if (requested.has("bandwidth")) {
    result.bandwidth = metadata.reduce(
      (sum, e) => sum + (e.Session?.bandwidth ?? 0),
      0
    );
  }

  if (includeSessions) result.sessions = metadata.map(playbackSession);

  return result;
}

export async function fetchPlexLibraries(
  config: PlexConfig,
  signal?: AbortSignal
): Promise<PlexData> {
  const sectionsUrl = new URL("library/sections", plexBase(config.url));
  sectionsUrl.searchParams.set("X-Plex-Token", config.token);

  const response = await credentialFetch(config.url, sectionsUrl.toString(), {
    signal,
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Plex responded with ${response.status}`);
  }

  const json = (await response.json()) as {
    MediaContainer: { Directory?: PlexSectionEntry[] };
  };

  const sections = json.MediaContainer.Directory ?? [];
  const requested = new Set(config.fields);
  const result: PlexData = {};

  // Initialize requested library fields to 0
  if (requested.has("library_movies")) result.library_movies = 0;
  if (requested.has("library_shows")) result.library_shows = 0;
  if (requested.has("library_episodes")) result.library_episodes = 0;
  if (requested.has("library_music")) result.library_music = 0;

  await Promise.all(
    sections.map(async (section) => {
      // /library/sections/{key} returns filters/config, not items.
      // /library/sections/{key}/all with X-Plex-Container-Size=0 returns only
      // MediaContainer.totalSize — the full count without transferring items.
      const queries: Array<{
        field: PlexField;
        extraParams?: Record<string, string>;
      }> = [];

      if (section.type === "movie" && requested.has("library_movies")) {
        queries.push({ field: "library_movies" });
      }
      if (section.type === "show") {
        if (requested.has("library_shows")) queries.push({ field: "library_shows" });
        // type=4 filters to episodes so totalSize is the episode count
        if (requested.has("library_episodes")) {
          queries.push({ field: "library_episodes", extraParams: { type: "4" } });
        }
      }
      if (section.type === "artist" && requested.has("library_music")) {
        // type=9 filters to albums
        queries.push({ field: "library_music", extraParams: { type: "9" } });
      }

      await Promise.all(
        queries.map(async ({ field, extraParams }) => {
          const url = new URL(`library/sections/${section.key}/all`, plexBase(config.url));
          url.searchParams.set("X-Plex-Token", config.token);
          url.searchParams.set("X-Plex-Container-Size", "0");
          url.searchParams.set("X-Plex-Container-Start", "0");
          if (extraParams) {
            for (const [k, v] of Object.entries(extraParams)) {
              url.searchParams.set(k, v);
            }
          }

          const res = await credentialFetch(config.url, url.toString(), {
            signal,
            headers: { Accept: "application/json" },
          });
          if (!res.ok) return;

          const data = (await res.json()) as { MediaContainer: { totalSize?: number } };
          result[field] = (result[field] ?? 0) + (data.MediaContainer.totalSize ?? 0);
        })
      );
    })
  );

  return result;
}

export { SESSION_FIELDS, LIBRARY_FIELDS };
