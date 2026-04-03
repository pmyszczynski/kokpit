import { z } from "zod";

export interface QbittorrentConfig {
  url: string;
  username: string;
  password: string;
}

export const QbittorrentConfigSchema = z.object({
  url: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
});

export interface TransferInfo {
  dl_info_speed: number;
  up_info_speed: number;
  dl_info_data: number;
  up_info_data: number;
}

export interface Torrent {
  hash: string;
  name: string;
  progress: number;
  dlspeed: number;
  upspeed: number;
}

let sidCache: { url: string; username: string; sid: string } | null = null;

export function clearSidCache(): void {
  sidCache = null;
}

async function getSession(
  config: QbittorrentConfig,
  signal?: AbortSignal
): Promise<string> {
  if (sidCache && sidCache.url === config.url && sidCache.username === config.username) {
    return sidCache.sid;
  }

  const loginUrl = new URL("/api/v2/auth/login", config.url).toString();
  const body = new URLSearchParams({
    username: config.username,
    password: config.password,
  }).toString();

  const response = await fetch(loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal,
  });

  if (!response.ok) {
    throw new Error(`qBittorrent login failed with ${response.status}`);
  }

  const setCookie = response.headers.get("set-cookie") ?? "";
  const sidMatch = setCookie.match(/SID=([^;]+)/);
  if (!sidMatch) {
    throw new Error("qBittorrent login did not return a SID cookie");
  }

  const sid = sidMatch[1];
  sidCache = { url: config.url, username: config.username, sid };
  return sid;
}

async function fetchWithAuth(
  config: QbittorrentConfig,
  path: string,
  signal?: AbortSignal
): Promise<Response> {
  const sid = await getSession(config, signal);
  const url = new URL(path, config.url).toString();

  let response = await fetch(url, {
    headers: { Cookie: `SID=${sid}` },
    signal,
  });

  if (response.status === 403) {
    sidCache = null;
    const newSid = await getSession(config, signal);
    response = await fetch(url, {
      headers: { Cookie: `SID=${newSid}` },
      signal,
    });
  }

  if (!response.ok) {
    throw new Error(`qBittorrent responded with ${response.status}`);
  }

  return response;
}

export async function fetchTransferInfo(
  config: QbittorrentConfig,
  signal?: AbortSignal
): Promise<TransferInfo> {
  const response = await fetchWithAuth(config, "/api/v2/transfer/info", signal);
  return response.json() as Promise<TransferInfo>;
}

export async function fetchTorrents(
  config: QbittorrentConfig,
  signal?: AbortSignal
): Promise<Torrent[]> {
  const response = await fetchWithAuth(config, "/api/v2/torrents/info", signal);
  return response.json() as Promise<Torrent[]>;
}
