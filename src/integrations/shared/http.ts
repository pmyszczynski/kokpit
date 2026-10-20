import { credentialFetch } from "./credentialFetch";

export interface ApiKeyConfig {
  url: string;
  api_key: string;
}

/**
 * Fetches a URL relative to config.url, injecting an X-Api-Key header.
 * Strips leading slashes from relative paths so new URL() resolves relative
 * to the full config.url (including any base path) rather than the origin.
 * Absolute URLs must stay within the configured origin.
 */
export async function fetchWithApiKey(
  config: ApiKeyConfig,
  path: string,
  signal?: AbortSignal,
  serviceName = "Service"
): Promise<Response> {
  const relativePath = /^https?:\/\//i.test(path) ? path : path.replace(/^\/+/, "");
  const url = new URL(relativePath, config.url).toString();
  const response = await credentialFetch(config.url, url, {
    headers: { "X-Api-Key": config.api_key },
    signal,
  });
  if (!response.ok) {
    throw new Error(`${serviceName} responded with ${response.status}`);
  }
  return response;
}
