import { lookup as dnsLookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";
import ipaddr from "ipaddr.js";

const MAX_REDIRECTS = 5;

export class SsrfBlockedError extends Error {
  constructor(hostname: string) {
    super(`Blocked outbound request to "${hostname}": resolves to a non-public address`);
    this.name = "SsrfBlockedError";
  }
}

/**
 * Whether a resolved address is safe to connect to. "unicast" is an
 * ordinary public address (ipaddr.js's term for anything not in a
 * special-purpose IANA range). Ranges like linkLocal (which covers every
 * cloud provider's 169.254.169.254 metadata address) and unspecified/
 * multicast/reserved are never a legitimate icon-detection target, so they
 * stay blocked even when private-network access is explicitly allowed.
 */
function isAllowedRange(range: string, allowPrivateNetworks: boolean): boolean {
  if (range === "unicast") return true;
  if (allowPrivateNetworks) {
    return range === "private" || range === "loopback" || range === "uniqueLocal";
  }
  return false;
}

async function resolveValidatedAddresses(
  hostname: string,
  allowPrivateNetworks: boolean
): Promise<{ address: string; family: 4 | 6 }[]> {
  let resolved: { address: string; family: number }[];
  try {
    resolved = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SsrfBlockedError(hostname);
  }
  if (resolved.length === 0) {
    throw new SsrfBlockedError(hostname);
  }

  const allowed = resolved.filter((r) => {
    try {
      return isAllowedRange(ipaddr.process(r.address).range(), allowPrivateNetworks);
    } catch {
      return false;
    }
  });
  // All-or-nothing: if any resolved address for this hostname is
  // disallowed, refuse the whole thing rather than racing which address
  // the connection ends up using.
  if (allowed.length !== resolved.length) {
    throw new SsrfBlockedError(hostname);
  }

  return allowed.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
}

/**
 * Builds a dispatcher whose DNS step always returns the exact addresses we
 * already validated, regardless of what a live lookup would return for the
 * hostname at connect time. This is what prevents DNS rebinding: without
 * it, undici would re-resolve the hostname itself when opening the TCP
 * connection, and a second (attacker-controlled) DNS answer between our
 * check and the actual connect could point anywhere.
 */
function createPinnedDispatcher(addresses: { address: string; family: 4 | 6 }[]): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        callback(null, addresses.map((a) => ({ address: a.address, family: a.family })));
      },
    },
  });
}

function isBlockedProtocol(protocol: string): boolean {
  return protocol !== "http:" && protocol !== "https:";
}

export interface SsrfSafeFetchOptions {
  method?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  allowPrivateNetworks: boolean;
}

/**
 * A fetch() replacement for outbound requests to caller-supplied URLs:
 * resolves + validates the destination itself (see resolveValidatedAddresses),
 * pins the actual connection to the validated address, and walks redirects
 * manually so every hop gets the same validation — a plain `redirect:
 * "follow"` fetch would blindly trust wherever a 3xx points next.
 */
export async function ssrfSafeFetch(
  rawUrl: string,
  options: SsrfSafeFetchOptions
): Promise<Response> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl);
  }

  for (let hop = 0; ; hop++) {
    if (isBlockedProtocol(target.protocol)) {
      throw new SsrfBlockedError(target.hostname);
    }
    if (hop > MAX_REDIRECTS) {
      throw new SsrfBlockedError(target.hostname);
    }

    const addresses = await resolveValidatedAddresses(target.hostname, options.allowPrivateNetworks);
    const dispatcher = createPinnedDispatcher(addresses);

    const response = (await undiciFetch(target.toString(), {
      method: options.method ?? "GET",
      signal: options.signal,
      headers: options.headers,
      redirect: "manual",
      dispatcher,
    })) as unknown as Response;

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      try {
        target = new URL(location, target);
      } catch {
        throw new SsrfBlockedError(location);
      }
      continue;
    }

    return response;
  }
}
