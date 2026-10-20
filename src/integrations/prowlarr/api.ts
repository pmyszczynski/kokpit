import { z } from "zod";
import { fetchWithApiKey } from "../shared/http";

export interface ProwlarrConfig {
  url: string;
  api_key: string;
}

export const ProwlarrConfigSchema = z.object({
  url: z.string().url(),
  api_key: z.string().min(1),
});

// Internal schema for indexers returned by GET /api/v1/indexer
const IndexerSchema = z.object({
  id: z.number(),
  name: z.string(),
  enable: z.boolean(),
  protocol: z.string(),
});

// Internal schema for GET /api/v1/indexerstatus — only failing indexers appear
const IndexerStatusSchema = z.object({
  indexerId: z.number(),
});

// Internal schema for GET /api/v1/history
const HistoryResponseSchema = z.object({
  totalRecords: z.number(),
  records: z.array(z.unknown()),
});

export interface ProwlarrStats {
  totalIndexers: number;
  enabledIndexers: number;
  failingIndexers: number;
  totalGrabs: number;
  usenetIndexers: number;
  torrentIndexers: number;
}

async function fetchWithAuth(
  config: ProwlarrConfig,
  path: string,
  signal?: AbortSignal
): Promise<Response> {
  return fetchWithApiKey(config, path, signal, "Prowlarr");
}

export async function fetchStats(
  config: ProwlarrConfig,
  signal?: AbortSignal
): Promise<ProwlarrStats> {
  const [indexersRes, statusRes, historyRes] = await Promise.all([
    fetchWithAuth(config, "api/v1/indexer", signal),
    fetchWithAuth(config, "api/v1/indexerstatus", signal),
    fetchWithAuth(
      config,
      "api/v1/history?pageSize=1&sortKey=date&sortDirection=descending",
      signal
    ),
  ]);

  const [indexers, statuses, history] = await Promise.all([
    indexersRes.json().then((d) => z.array(IndexerSchema).parse(d)),
    statusRes.json().then((d) => z.array(IndexerStatusSchema).parse(d)),
    historyRes.json().then((d) => HistoryResponseSchema.parse(d)),
  ]);

  return {
    totalIndexers: indexers.length,
    enabledIndexers: indexers.filter((i) => i.enable).length,
    failingIndexers: statuses.length,
    totalGrabs: history.totalRecords,
    // Protocol totals include disabled indexers, just like totalIndexers.
    usenetIndexers: indexers.filter((i) => i.protocol === "usenet").length,
    torrentIndexers: indexers.filter((i) => i.protocol === "torrent").length,
  };
}
