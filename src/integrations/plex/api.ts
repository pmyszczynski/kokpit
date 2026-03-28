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

export type PlexData = Partial<Record<PlexField, number>>;

export interface PlexConfig {
  url: string;
  token: string;
  fields: PlexField[];
}

interface PlexSessionMetadata {
  TranscodeSession?: object;
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

interface PlexSectionDetail {
  MediaContainer: {
    size?: number;
    leafCount?: number;
  };
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

export async function fetchPlexSessions(
  config: PlexConfig,
  signal?: AbortSignal
): Promise<PlexData> {
  const url = new URL("/status/sessions", config.url);
  url.searchParams.set("X-Plex-Token", config.token);

  const response = await fetch(url.toString(), {
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

  return result;
}

export async function fetchPlexLibraries(
  config: PlexConfig,
  signal?: AbortSignal
): Promise<PlexData> {
  const sectionsUrl = new URL("/library/sections", config.url);
  sectionsUrl.searchParams.set("X-Plex-Token", config.token);

  const response = await fetch(sectionsUrl.toString(), {
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
      const detailUrl = new URL(
        `/library/sections/${section.key}`,
        config.url
      );
      detailUrl.searchParams.set("X-Plex-Token", config.token);

      const detailRes = await fetch(detailUrl.toString(), {
        signal,
        headers: { Accept: "application/json" },
      });
      if (!detailRes.ok) return;

      const detail = (await detailRes.json()) as PlexSectionDetail;
      const count = detail.MediaContainer.size ?? 0;
      const leafCount = detail.MediaContainer.leafCount ?? 0;

      if (section.type === "movie" && requested.has("library_movies")) {
        result.library_movies = (result.library_movies ?? 0) + count;
      }
      if (section.type === "show") {
        if (requested.has("library_shows")) {
          result.library_shows = (result.library_shows ?? 0) + count;
        }
        if (requested.has("library_episodes")) {
          result.library_episodes = (result.library_episodes ?? 0) + leafCount;
        }
      }
      if (section.type === "artist" && requested.has("library_music")) {
        result.library_music = (result.library_music ?? 0) + count;
      }
    })
  );

  return result;
}

export { SESSION_FIELDS, LIBRARY_FIELDS };
