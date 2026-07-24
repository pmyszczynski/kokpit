import { z } from "zod";

export interface TdarrConfig {
  url: string;
  apikey?: string;
}

export const TdarrConfigSchema = z.object({
  url: z.string().url(),
  apikey: z.string().optional(),
});

export interface TdarrStats {
  transcodeQueue: number;
  healthCheckQueue: number;
  transcoded: number;
  errored: number;
  spaceSavedGb: number;
  totalFiles: number;
  activeWorkers: number;
  fps: number;
}

// Tdarr's cruddb "statistics" doc. Every field is optional/coerced because
// different Tdarr versions populate a different subset of these counters —
// we want a partial response to produce partial (not thrown) stats.
const TdarrStatisticsSchema = z
  .object({
    table1Count: z.coerce.number().optional(),
    table1ViewableCount: z.coerce.number().optional(),
    table2Count: z.coerce.number().optional(),
    table2ViewableCount: z.coerce.number().optional(),
    table3Count: z.coerce.number().optional(),
    table3ViewableCount: z.coerce.number().optional(),
    table4Count: z.coerce.number().optional(),
    table4ViewableCount: z.coerce.number().optional(),
    table6Count: z.coerce.number().optional(),
    table6ViewableCount: z.coerce.number().optional(),
    sizeDiff: z.coerce.number().optional(),
    totalFileCount: z.coerce.number().optional(),
  })
  .passthrough();

const TdarrWorkerSchema = z
  .object({
    fps: z.coerce.number().optional(),
  })
  .passthrough();

const TdarrNodeSchema = z
  .object({
    workers: z.record(z.string(), TdarrWorkerSchema).optional(),
  })
  .passthrough();

const TdarrNodesResponseSchema = z.record(z.string(), TdarrNodeSchema);

function buildHeaders(config: TdarrConfig): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apikey) {
    headers["x-api-key"] = config.apikey;
  }
  return headers;
}

export async function fetchTdarrStats(
  config: TdarrConfig,
  signal?: AbortSignal
): Promise<TdarrStats> {
  const base = config.url.endsWith("/") ? config.url : `${config.url}/`;
  const cruddbUrl = new URL("api/v2/cruddb", base).toString();
  const headers = buildHeaders(config);

  const response = await fetch(cruddbUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      data: {
        collection: "StatisticsJSONDB",
        mode: "getById",
        docID: "statistics",
      },
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Tdarr responded with ${response.status}`);
  }

  const raw = await response.json();

  // Some Tdarr versions return the statistics doc directly from cruddb,
  // others wrap it under a "statistics" key. Accept both.
  const candidate =
    raw !== null &&
    typeof raw === "object" &&
    "statistics" in raw &&
    (raw as { statistics?: unknown }).statistics !== null &&
    typeof (raw as { statistics?: unknown }).statistics === "object"
      ? (raw as { statistics: unknown }).statistics
      : raw;

  const stats = TdarrStatisticsSchema.parse(candidate);

  const transcodeQueue = stats.table1ViewableCount ?? stats.table1Count ?? 0;
  const healthCheckQueue = stats.table4ViewableCount ?? stats.table4Count ?? 0;
  const transcoded = stats.table2ViewableCount ?? stats.table2Count ?? 0;
  const errored =
    (stats.table3ViewableCount ?? stats.table3Count ?? 0) +
    (stats.table6ViewableCount ?? stats.table6Count ?? 0);
  const spaceSavedGb = stats.sizeDiff ?? 0;
  const totalFiles = stats.totalFileCount ?? 0;

  let activeWorkers = 0;
  let fps = 0;

  // Best-effort: the nodes/workers endpoint must never break the primary
  // stats, so any failure (network, non-2xx, unexpected shape) just leaves
  // activeWorkers/fps at their zero defaults.
  try {
    const nodesUrl = new URL("api/v2/get-nodes", base).toString();
    const nodesResponse = await fetch(nodesUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
      signal,
    });

    if (nodesResponse.ok) {
      const nodesRaw = await nodesResponse.json();
      const nodes = TdarrNodesResponseSchema.parse(nodesRaw);

      let fpsTotal = 0;
      for (const node of Object.values(nodes)) {
        const workers = node.workers ?? {};
        for (const worker of Object.values(workers)) {
          activeWorkers += 1;
          fpsTotal += worker.fps ?? 0;
        }
      }
      fps = Math.round(fpsTotal * 10) / 10;
    }
  } catch {
    activeWorkers = 0;
    fps = 0;
  }

  return {
    transcodeQueue,
    healthCheckQueue,
    transcoded,
    errored,
    spaceSavedGb,
    totalFiles,
    activeWorkers,
    fps,
  };
}
