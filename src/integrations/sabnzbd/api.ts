import { z } from "zod";

export interface SabnzbdConfig {
  url: string;
  apikey: string;
}

export const SabnzbdConfigSchema = z.object({
  url: z.string().url(),
  apikey: z.string().min(1),
});

const QueueResponseSchema = z.object({
  queue: z.object({
    kbpersec: z.number(),
    mb: z.number(),
    noofslots: z.number(),
  }),
});

export interface SabnzbdQueueData {
  speedBytesPerSec: number;
  totalMb: number;
  queueCount: number;
}

export async function fetchQueueData(
  config: SabnzbdConfig,
  signal?: AbortSignal
): Promise<SabnzbdQueueData> {
  const url = new URL("/api", config.url);
  url.searchParams.set("output", "json");
  url.searchParams.set("apikey", config.apikey);
  url.searchParams.set("mode", "queue");

  const response = await fetch(url.toString(), { signal });

  if (!response.ok) {
    throw new Error(`SABnzbd responded with ${response.status}`);
  }

  const raw = await response.json();
  const parsed = QueueResponseSchema.parse(raw);
  const q = parsed.queue;

  return {
    speedBytesPerSec: q.kbpersec * 1000,
    totalMb: q.mb,
    queueCount: q.noofslots,
  };
}
