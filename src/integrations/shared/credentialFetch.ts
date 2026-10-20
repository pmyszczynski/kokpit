import { WidgetFetchError } from "@/widgets/publicFetchError";
import { parseHttpUrl } from "./httpUrl";

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** A controlled error: never include a credential-bearing URL or Location. */
export class CredentialRedirectError extends WidgetFetchError {
  constructor(diagnostic?: { integration: string; stage: string }) {
    super("widget_upstream_redirect_blocked", {
      integration: diagnostic?.integration ?? "unknown",
      stage: diagnostic?.stage ?? "redirect",
      retryable: false,
    });
    this.name = "CredentialRedirectError";
  }
}

function safeUrl(value: string | URL, base?: URL): URL {
  let resolved: URL;
  try {
    resolved = new URL(value, base);
  } catch {
    throw new CredentialRedirectError();
  }
  const url = parseHttpUrl(resolved.href);
  if (!url) throw new CredentialRedirectError();
  // Fragments are never sent over HTTP and must not disguise a redirect loop.
  url.hash = "";
  return url;
}

/**
 * Credential-bearing requests stay within the configured scheme/host/port.
 * Only GET/HEAD can follow redirects; bodies and other methods are never replayed.
 * Callers retain URL construction, response handling and the whole-chain timeout.
 */
export async function credentialFetch(
  configuredBase: string,
  targetUrl: string | URL,
  init: Omit<RequestInit, "redirect"> = {}
): Promise<Response> {
  const base = safeUrl(configuredBase);
  let target = safeUrl(targetUrl);
  const visited = new Set<string>();
  const method = (init.method ?? "GET").toUpperCase();
  const canFollow = (method === "GET" || method === "HEAD") && init.body == null;

  for (let redirects = 0; ; redirects++) {
    if (target.origin !== base.origin || visited.has(target.href)) {
      throw new CredentialRedirectError();
    }
    visited.add(target.href);
    init.signal?.throwIfAborted();
    const response = await fetch(target.href, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    // Release every discarded body, including on rejected redirects.
    await response.body?.cancel().catch(() => {});
    const location = response.headers.get("location");
    if (!canFollow || redirects >= MAX_REDIRECTS || !location) {
      throw new CredentialRedirectError();
    }
    target = safeUrl(location, target);
  }
}
