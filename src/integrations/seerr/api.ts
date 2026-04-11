import { z } from "zod";
import { fetchWithApiKey } from "@/integrations/shared/http";

export interface SeerrConfig {
  url: string;
  api_key: string;
}

export const SeerrConfigSchema = z.object({
  url: z.string().url(),
  api_key: z.string().min(1),
});

// ── Stats ────────────────────────────────────────────────────────────────────

export interface SeerrStats {
  pending: number;
  approved: number;
  available: number;
  total: number;
}

const PageInfoResponseSchema = z.object({
  pageInfo: z.object({ results: z.number() }),
});

/**
 * Fetches request counts by making 4 parallel requests with take=1 per filter.
 * pageInfo.results holds the total count for that filter — no need to fetch all records.
 */
export async function fetchStats(
  config: SeerrConfig,
  signal?: AbortSignal
): Promise<SeerrStats> {
  const [allRes, pendingRes, approvedRes, availableRes] = await Promise.all([
    fetchWithApiKey(config, "api/v1/request?filter=all&take=1",       signal, "Seerr"),
    fetchWithApiKey(config, "api/v1/request?filter=pending&take=1",   signal, "Seerr"),
    fetchWithApiKey(config, "api/v1/request?filter=approved&take=1",  signal, "Seerr"),
    fetchWithApiKey(config, "api/v1/request?filter=available&take=1", signal, "Seerr"),
  ]);

  const parseCount = async (r: Response) =>
    PageInfoResponseSchema.parse(await r.json()).pageInfo.results;

  const [total, pending, approved, available] = await Promise.all(
    [allRes, pendingRes, approvedRes, availableRes].map(parseCount)
  );

  return { total, pending, approved, available };
}

// ── Requests list ────────────────────────────────────────────────────────────

// Internal schema matching the Seerr/Overseerr/Jellyseerr MediaRequest API shape.
// title/name are optional: older instances may not embed them in the request response.
const RawRequestSchema = z.object({
  id: z.number(),
  status: z.number(),      // 1=PENDING, 2=APPROVED, 3=DECLINED, 4=FAILED
  createdAt: z.string().datetime(),
  type: z.enum(["movie", "tv"]),
  requestedBy: z.object({ displayName: z.string() }),
  media: z.object({
    tmdbId: z.number(),
    status: z.number(),    // 1=UNKNOWN … 5=AVAILABLE
    title: z.string().optional().nullable(),  // movies
    name: z.string().optional().nullable(),   // TV shows (some API versions)
  }),
});

// Widget-facing type — flat and clean.
const SeerrRequestSchema = RawRequestSchema.transform((r) => ({
  id: r.id,
  requestStatus: r.status,
  mediaStatus: r.media.status,
  mediaType: r.type,
  title: r.media.title ?? r.media.name ?? null,
  tmdbId: r.media.tmdbId,
  requestedBy: r.requestedBy.displayName,
  createdAt: r.createdAt,
}));

export type SeerrRequest = z.output<typeof SeerrRequestSchema>;

export async function fetchRequests(
  config: SeerrConfig,
  signal?: AbortSignal
): Promise<SeerrRequest[]> {
  const response = await fetchWithApiKey(
    config,
    "api/v1/request?take=15&sort=added&filter=all",
    signal,
    "Seerr"
  );
  const data = await response.json();
  return z.object({ results: z.array(SeerrRequestSchema) }).parse(data).results;
}
