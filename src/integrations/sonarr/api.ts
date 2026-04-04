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

const SonarrEpisodeSchema = z.object({
  id: z.number(),
  title: z.string(),
  seriesTitle: z.string(),
  airDateUtc: z.string(),
  seasonNumber: z.number(),
  episodeNumber: z.number(),
  hasFile: z.boolean(),
  monitored: z.boolean(),
});

export type SonarrEpisode = z.infer<typeof SonarrEpisodeSchema>;

const SonarrQueueItemSchema = z.object({
  id: z.number(),
  title: z.string(),
  seriesTitle: z.string(),
  status: z.string(),
  timeleft: z.string().optional(),
  size: z.number(),
  sizeleft: z.number(),
  trackedDownloadStatus: z.string(),
});

export type SonarrQueueItem = z.infer<typeof SonarrQueueItemSchema>;

const SonarrQueueResponseSchema = z.object({
  records: z.array(SonarrQueueItemSchema),
});

async function fetchWithAuth(
  config: SonarrConfig,
  path: string,
  signal?: AbortSignal
): Promise<Response> {
  const url = new URL(path, config.url).toString();
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
