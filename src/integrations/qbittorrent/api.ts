import { z } from "zod";
import { WidgetFetchError } from "@/widgets/publicFetchError";

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

type SessionCookie = {
  name: "SID" | "QBIT_SID" | `QBT_SID_${number}`;
  value: string;
};

const sidCache = new Map<string, SessionCookie>();
const loginInFlight = new Map<string, Promise<SessionCookie>>();
const MAX_LOGIN_RESULT_BYTES = 64;

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

async function boundedLoginResult(
  response: Response,
  signal?: AbortSignal
): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;

  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_LOGIN_RESULT_BYTES) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw abortedRequestError();
    }
    return undefined;
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(result);
}

function sessionCookie(response: Response): SessionCookie | undefined {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/(?:^|,\s*)(QBT_SID_\d+|QBIT_SID|SID)=([^;,\s]+)/);
  return match ? { name: match[1] as SessionCookie["name"], value: match[2] } : undefined;
}

function abortedRequestError(): Error {
  const error = new Error("qBittorrent request aborted");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

async function qBittorrentFetch(
  input: string,
  init: RequestInit,
  stage: string
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (init.signal?.aborted || isAbortError(error)) {
      throw abortedRequestError();
    }
    throw new WidgetFetchError("widget_upstream_unreachable", {
      integration: "qbittorrent",
      stage,
      retryable: true,
    });
  }
}

async function responseJson(
  response: Response,
  stage: string,
  signal?: AbortSignal
): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw abortedRequestError();
    }
    throw new WidgetFetchError("widget_invalid_json", {
      integration: "qbittorrent",
      stage,
      retryable: true,
    });
  }
}

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
): Promise<SessionCookie> {
  const key = cacheKey(config);

  const cached = sidCache.get(key);
  if (cached) return cached;

  const inFlight = loginInFlight.get(key);
  if (inFlight) return inFlight;

  // The abort handler needs this exact promise identity before the async
  // operation is created, so a completed older login cannot evict a newer one.
  const loginState: { promise?: Promise<SessionCookie> } = {};
  const onAbort = () => {
    if (loginState.promise && loginInFlight.get(key) === loginState.promise) {
      loginInFlight.delete(key);
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const loginPromise = (async () => {
    try {
      const base = config.url.endsWith("/") ? config.url : `${config.url}/`;
      const loginUrl = new URL("api/v2/auth/login", base).toString();
      const body = new URLSearchParams({
        username: config.username,
        password: config.password,
      }).toString();

      const response = await qBittorrentFetch(loginUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal,
      }, "login");

      if (!response.ok) {
        const authRejected = response.status === 401;
        const accessBlocked = response.status === 403;
        throw new WidgetFetchError(
          authRejected
            ? "widget_upstream_auth_failed"
            : accessBlocked
              ? "widget_upstream_access_blocked"
              : "widget_upstream_error",
          {
            integration: "qbittorrent",
            stage: "login",
            upstreamStatus: response.status,
            retryable:
              !authRejected && !accessBlocked && isRetryableHttpStatus(response.status),
          }
        );
      }

      if ((await boundedLoginResult(response, signal)) === "Fails.") {
        throw new WidgetFetchError("widget_upstream_auth_failed", {
          integration: "qbittorrent",
          stage: "login",
          retryable: false,
        });
      }

      const session = sessionCookie(response);
      if (!session) {
        throw new WidgetFetchError("widget_upstream_session_failed", {
          integration: "qbittorrent",
          stage: "session",
          retryable: true,
        });
      }

      if (!signal?.aborted && loginInFlight.get(key) === loginState.promise) {
        sidCache.set(key, session);
      }
      return session;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      if (loginState.promise && loginInFlight.get(key) === loginState.promise) {
        loginInFlight.delete(key);
      }
    }
  })();

  loginState.promise = loginPromise;
  loginInFlight.set(key, loginPromise);
  if (signal?.aborted) onAbort();
  return loginPromise;
}

async function fetchWithAuth(
  config: QbittorrentConfig,
  path: string,
  signal?: AbortSignal
): Promise<Response> {
  const session = await getSession(config, signal);
  const base = config.url.endsWith("/") ? config.url : `${config.url}/`;
  const url = new URL(path, base).toString();
  const stage = path === "api/v2/transfer/info" ? "transfer-info" : "torrents-info";

  let response = await qBittorrentFetch(url, {
    headers: { Cookie: `${session.name}=${session.value}` },
    signal,
  }, stage);

  if (response.status === 403) {
    sidCache.delete(cacheKey(config));
    const newSession = await getSession(config, signal);
    response = await qBittorrentFetch(url, {
      headers: { Cookie: `${newSession.name}=${newSession.value}` },
      signal,
    }, stage);
  }

  if (!response.ok) {
    throw new WidgetFetchError("widget_upstream_error", {
      integration: "qbittorrent",
      stage,
      upstreamStatus: response.status,
      retryable: isRetryableHttpStatus(response.status),
    });
  }

  return response;
}

export async function fetchTransferInfo(
  config: QbittorrentConfig,
  signal?: AbortSignal
): Promise<TransferInfo> {
  const response = await fetchWithAuth(config, "api/v2/transfer/info", signal);
  const data = await responseJson(response, "transfer-info-json", signal);
  const parsed = TransferInfoSchema.safeParse(data);
  if (!parsed.success) {
    throw new WidgetFetchError("widget_invalid_response", {
      integration: "qbittorrent",
      stage: "transfer-info-validation",
      retryable: true,
    });
  }
  return parsed.data;
}

export async function fetchTorrents(
  config: QbittorrentConfig,
  signal?: AbortSignal
): Promise<Torrent[]> {
  const response = await fetchWithAuth(config, "api/v2/torrents/info", signal);
  const data = await responseJson(response, "torrents-info-json", signal);
  const parsed = z.array(TorrentSchema).safeParse(data);
  if (!parsed.success) {
    throw new WidgetFetchError("widget_invalid_response", {
      integration: "qbittorrent",
      stage: "torrents-info-validation",
      retryable: true,
    });
  }
  return parsed.data;
}
