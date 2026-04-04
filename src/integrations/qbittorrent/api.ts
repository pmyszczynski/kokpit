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

const TransferInfoSchema = z.object({
  dl_info_speed: z.number(),
  up_info_speed: z.number(),
  dl_info_data: z.number(),
  up_info_data: z.number(),
});

export type TransferInfo = z.infer<typeof TransferInfoSchema>;

const TorrentSchema = z.object({
  hash: z.string(),
  name: z.string(),
  progress: z.number(),
  dlspeed: z.number(),
  upspeed: z.number(),
});

export type Torrent = z.infer<typeof TorrentSchema>;

const sidCache = new Map<string, string>();
const loginInFlight = new Map<string, Promise<string>>();

function cacheKey(config: QbittorrentConfig): string {
  return `${config.url}::${config.username}`;
}

export function clearSidCache(): void {
  sidCache.clear();
  loginInFlight.clear();
}

async function getSession(
  config: QbittorrentConfig,
  signal?: AbortSignal
): Promise<string> {
  const key = cacheKey(config);

  const cached = sidCache.get(key);
  if (cached) return cached;

  const inFlight = loginInFlight.get(key);
  if (inFlight) return inFlight;

  const loginPromise = (async () => {
    try {
      const base = config.url.endsWith("/") ? config.url : `${config.url}/`;
      const loginUrl = new URL("api/v2/auth/login", base).toString();
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
      sidCache.set(key, sid);
      return sid;
    } finally {
      loginInFlight.delete(key);
    }
  })();

  loginInFlight.set(key, loginPromise);
  return loginPromise;
}

async function fetchWithAuth(
  config: QbittorrentConfig,
  path: string,
  signal?: AbortSignal
): Promise<Response> {
  const sid = await getSession(config, signal);
  const base = config.url.endsWith("/") ? config.url : `${config.url}/`;
  const url = new URL(path, base).toString();

  let response = await fetch(url, {
    headers: { Cookie: `SID=${sid}` },
    signal,
  });

  if (response.status === 403) {
    sidCache.delete(cacheKey(config));
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
  const response = await fetchWithAuth(config, "api/v2/transfer/info", signal);
  const data = await response.json();
  return TransferInfoSchema.parse(data);
}

export async function fetchTorrents(
  config: QbittorrentConfig,
  signal?: AbortSignal
): Promise<Torrent[]> {
  const response = await fetchWithAuth(config, "api/v2/torrents/info", signal);
  const data = await response.json();
  return z.array(TorrentSchema).parse(data);
}
