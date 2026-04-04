import { z } from "zod";

export interface SonarrConfig {
  url: string;
  api_key: string;
  days: number;
}

export const SonarrConfigSchema = z.object({
  url: z.string().url(),
  api_key: z.string().min(1),
  days: z.coerce.number().int().min(1).max(30).default(7),
});

// Internal schema matching the actual Sonarr EpisodeResource API shape.
const EpisodeResourceSchema = z.object({
  id: z.number(),
  title: z.string(),
  series: z.object({ title: z.string() }),
  airDateUtc: z.string(),
  seasonNumber: z.number(),
  episodeNumber: z.number(),
  hasFile: z.boolean(),
  monitored: z.boolean(),
});

// Widget-facing shape with flat seriesTitle extracted from series.title.
const SonarrEpisodeSchema = EpisodeResourceSchema.transform((r) => ({
  id: r.id,
  title: r.title,
  seriesTitle: r.series.title,
  airDateUtc: r.airDateUtc,
  seasonNumber: r.seasonNumber,
  episodeNumber: r.episodeNumber,
  hasFile: r.hasFile,
  monitored: r.monitored,
}));

export type SonarrEpisode = z.output<typeof SonarrEpisodeSchema>;

// Internal schema matching the actual Sonarr QueueResource API shape.
const QueueResourceSchema = z.object({
  id: z.number(),
  title: z.string(),
  series: z.object({ title: z.string() }),
  status: z.string(),
  timeleft: z.string().optional(),
  size: z.number(),
  sizeleft: z.number(),
  trackedDownloadStatus: z.string(),
});

// Widget-facing shape with flat seriesTitle extracted from series.title.
const SonarrQueueItemSchema = QueueResourceSchema.transform((r) => ({
  id: r.id,
  title: r.title,
  seriesTitle: r.series.title,
  status: r.status,
  timeleft: r.timeleft,
  size: r.size,
  sizeleft: r.sizeleft,
  trackedDownloadStatus: r.trackedDownloadStatus,
}));

export type SonarrQueueItem = z.output<typeof SonarrQueueItemSchema>;

const SonarrQueueResponseSchema = z.object({
  records: z.array(SonarrQueueItemSchema),
});

async function fetchWithAuth(
  config: SonarrConfig,
  path: string,
  signal?: AbortSignal
): Promise<Response> {
  // Strip leading slashes from relative paths so new URL resolves relative to
  // the full config.url (including any base path) rather than the origin.
  // Absolute URLs (http/https) are passed through unchanged.
  const relativePath = /^https?:\/\//i.test(path) ? path : path.replace(/^\/+/, "");
  const url = new URL(relativePath, config.url).toString();
  const response = await fetch(url, {
    headers: { "X-Api-Key": config.api_key },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Sonarr responded with ${response.status}`);
  }
  return response;
}

export async function fetchCalendar(
  config: SonarrConfig,
  signal?: AbortSignal
): Promise<SonarrEpisode[]> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + config.days);

  const path = `/api/v3/calendar?start=${start.toISOString()}&end=${end.toISOString()}`;
  const response = await fetchWithAuth(config, path, signal);
  const data = await response.json();
  return z.array(SonarrEpisodeSchema).parse(data);
}

export async function fetchQueue(
  config: SonarrConfig,
  signal?: AbortSignal
): Promise<SonarrQueueItem[]> {
  const response = await fetchWithAuth(
    config,
    "/api/v3/queue?pageSize=25&includeUnknownSeriesItems=false",
    signal
  );
  const data = await response.json();
  return SonarrQueueResponseSchema.parse(data).records;
}
