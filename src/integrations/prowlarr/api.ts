import { z } from "zod";

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
}

async function fetchWithAuth(
  config: ProwlarrConfig,
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
    throw new Error(`Prowlarr responded with ${response.status}`);
  }
  return response;
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
  };
}
