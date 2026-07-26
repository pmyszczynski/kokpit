import { z } from "zod";

export const TAUTULLI_SECTIONS = ["summary", "sessions"] as const;
export type TautulliSection = (typeof TAUTULLI_SECTIONS)[number];

export const TautulliConfigSchema = z.object({
  url: z.string().url(),
  api_key: z.string().min(1),
  sections: z
    .array(z.enum(TAUTULLI_SECTIONS))
    .min(1)
    .default(["summary", "sessions"]),
});
export type TautulliConfig = z.infer<typeof TautulliConfigSchema>;

export interface TautulliSummary {
  streamCount: number;
  directPlayCount: number;
  directStreamCount: number;
  transcodeCount: number;
  totalBandwidthKbps: number;
}

export interface TautulliSession {
  username: string;
  title: string;
  progressPercent: number;
  state: string;
  mediaType: string;
  transcodeDecision: string;
}

export interface TautulliActivityData {
  summary?: TautulliSummary;
  sessions?: TautulliSession[];
}

const NumericValueSchema = z
  .union([z.number(), z.string()])
  .transform((value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  })
  .catch(0);

const NullableTextSchema = z.string().nullish();

const RawSessionSchema = z.object({
  username: NullableTextSchema,
  user: NullableTextSchema,
  friendly_name: NullableTextSchema,
  full_title: NullableTextSchema,
  title: NullableTextSchema,
  progress_percent: NumericValueSchema.optional().default(0),
  state: NullableTextSchema,
  media_type: NullableTextSchema,
  transcode_decision: NullableTextSchema,
});

const ActivityDataSchema = z.object({
  stream_count: NumericValueSchema.optional().default(0),
  stream_count_direct_play: NumericValueSchema.optional().default(0),
  stream_count_direct_stream: NumericValueSchema.optional().default(0),
  stream_count_transcode: NumericValueSchema.optional().default(0),
  total_bandwidth: NumericValueSchema.optional().default(0),
  sessions: z.array(RawSessionSchema).catch([]).optional().default([]),
});

const EnvelopeSchema = z.object({
  response: z.object({
    result: z.string(),
    message: z.string().nullish(),
    data: z.unknown(),
  }),
});

function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function nonBlank(value: string | null | undefined, fallback: string): string {
  return value?.trim() ? value : fallback;
}

function abortedRequestError(): Error {
  const error = new Error("Tautulli request aborted");
  error.name = "AbortError";
  return error;
}

export async function fetchActivity(
  config: TautulliConfig,
  signal?: AbortSignal
): Promise<TautulliActivityData> {
  const url = new URL("api/v2", withTrailingSlash(config.url));
  url.searchParams.set("apikey", config.api_key);
  url.searchParams.set("cmd", "get_activity");

  let response: Response;
  try {
    response = await fetch(url.toString(), { signal });
  } catch {
    if (signal?.aborted) {
      throw abortedRequestError();
    }
    throw new Error("Tautulli network request failed");
  }
  if (!response.ok) {
    throw new Error(`Tautulli responded with ${response.status}`);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    if (signal?.aborted) {
      throw abortedRequestError();
    }
    throw new Error("Tautulli returned invalid JSON");
  }

  const envelope = EnvelopeSchema.safeParse(json);
  if (!envelope.success) {
    throw new Error("Tautulli returned an invalid activity response");
  }
  if (envelope.data.response.result !== "success") {
    throw new Error("Tautulli API request failed");
  }

  const parsedData = ActivityDataSchema.safeParse(envelope.data.response.data);
  if (!parsedData.success) {
    throw new Error("Tautulli returned an invalid activity response");
  }

  const raw = parsedData.data;
  const summary: TautulliSummary = {
    streamCount: raw.stream_count,
    directPlayCount: raw.stream_count_direct_play,
    directStreamCount: raw.stream_count_direct_stream,
    transcodeCount: raw.stream_count_transcode,
    totalBandwidthKbps: raw.total_bandwidth,
  };
  const sessions = raw.sessions.map((session) => ({
    username: nonBlank(
      session.username,
      nonBlank(session.user, nonBlank(session.friendly_name, "Unknown user"))
    ),
    title: nonBlank(session.full_title, nonBlank(session.title, "Unknown title")),
    progressPercent: Math.min(100, Math.max(0, session.progress_percent)),
    state: nonBlank(session.state, "unknown"),
    mediaType: nonBlank(session.media_type, "unknown"),
    transcodeDecision: nonBlank(session.transcode_decision, "unknown"),
  }));

  const selected = new Set(config.sections);
  return {
    ...(selected.has("summary") ? { summary } : {}),
    ...(selected.has("sessions") ? { sessions } : {}),
  };
}
