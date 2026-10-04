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
    kbpersec: z.coerce.number(),
    mb: z.coerce.number(),
    noofslots: z.number(),
    mbleft: z.preprocess(
      (value) => typeof value === "string" && value.trim() === "" ? null : value,
      z.union([z.number(), z.string()]).pipe(z.coerce.number<string | number>().nonnegative()).nullish().catch(null)
    ),
    timeleft: z.string().trim().min(1).nullish().catch(null),
    status: z.string().trim().min(1).nullish().catch(null),
  }),
});

export interface SabnzbdQueueData {
  speedBytesPerSec: number;
  totalMb: number;
  queueCount: number;
  /** Optional for compatibility with older or partial queue responses. */
  remainingMb?: number | null;
  timeLeft?: string | null;
  status?: string | null;
}

export async function fetchQueueData(
  config: SabnzbdConfig,
  signal?: AbortSignal
): Promise<SabnzbdQueueData> {
  const base = config.url.endsWith("/") ? config.url : `${config.url}/`;
  const url = new URL("api", base);
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
    remainingMb: q.mbleft ?? null,
    timeLeft: q.timeleft ?? null,
    status: q.status ?? null,
  };
}
