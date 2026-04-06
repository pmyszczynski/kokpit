import { z } from "zod";
import { fetchWithApiKey } from "@/integrations/shared/http";

export interface RadarrConfig {
  url: string;
  api_key: string;
}

export const RadarrConfigSchema = z.object({
  url: z.string().url(),
  api_key: z.string().min(1),
});

export interface RadarrStats {
  total: number;
  available: number;
  missing: number;
  wanted: number;
  upcoming: number;
  queued: number;
}

// Internal schema matching the actual Radarr MovieResource API shape.
const MovieResourceSchema = z.object({
  id: z.number(),
  hasFile: z.boolean(),
  monitored: z.boolean(),
  isAvailable: z.boolean(),
  status: z.string(),
});

// Internal schema matching the actual Radarr QueueResource API shape.
const QueueResourceSchema = z.object({
  id: z.number(),
  title: z.string(),
  movie: z.object({ title: z.string() }),
  status: z.string(),
  timeleft: z.string().optional(),
  size: z.number(),
  sizeleft: z.number(),
  trackedDownloadStatus: z.string(),
});

// Widget-facing shape with flat movieTitle extracted from movie.title.
const RadarrQueueItemSchema = QueueResourceSchema.transform((r) => ({
  id: r.id,
  title: r.title,
  movieTitle: r.movie.title,
  status: r.status,
  ...(r.timeleft !== undefined && { timeleft: r.timeleft }),
  size: r.size,
  sizeleft: r.sizeleft,
  trackedDownloadStatus: r.trackedDownloadStatus,
}));

export type RadarrQueueItem = z.output<typeof RadarrQueueItemSchema>;

const RadarrQueueResponseSchema = z.object({
  records: z.array(RadarrQueueItemSchema),
  totalRecords: z.number(),
});

export async function fetchStats(
  config: RadarrConfig,
  signal?: AbortSignal
): Promise<RadarrStats> {
  const [moviesResponse, queueResponse] = await Promise.all([
    fetchWithApiKey(config, "/api/v3/movie", signal, "Radarr"),
    fetchWithApiKey(config, "/api/v3/queue?pageSize=1", signal, "Radarr"),
  ]);

  const moviesData = await moviesResponse.json();
  const queueData = await queueResponse.json();

  const movies = z.array(MovieResourceSchema).parse(moviesData);
  const { totalRecords } = z
    .object({ totalRecords: z.number() })
    .parse(queueData);

  return {
    total: movies.length,
    available: movies.filter((m) => m.hasFile).length,
    missing: movies.filter((m) => m.monitored && !m.hasFile && m.isAvailable)
      .length,
    wanted: movies.filter((m) => m.monitored && !m.hasFile).length,
    upcoming: movies.filter(
      (m) => m.status === "announced" || m.status === "inCinemas"
    ).length,
    queued: totalRecords,
  };
}

export async function fetchQueue(
  config: RadarrConfig,
  signal?: AbortSignal
): Promise<RadarrQueueItem[]> {
  const response = await fetchWithApiKey(
    config,
    "/api/v3/queue?pageSize=25&includeMovie=true&includeUnknownMovieItems=false",
    signal,
    "Radarr"
  );
  const data = await response.json();
  return RadarrQueueResponseSchema.parse(data).records;
}
