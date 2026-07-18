import { fetchWithHardTimeout } from "@/lib/fetchTimeout";
import { ssrfSafeFetch } from "@/lib/ssrfGuard";
import { guessNamesFromHostname, matchIconLibraries } from "@/lib/iconLibraries";

const DETECT_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 100_000;

export type IconSource = "page" | "favicon" | "dashboard-icons" | "simple-icons";

export interface IconDetectionResult {
  icon: string | null;
  source: IconSource | null;
}

interface IconCandidate {
  href: string;
  rel: string;
  sizes: string | null;
  type: string | null;
}

const ICON_LINK_REGEX = /<link\b[^>]*>/gi;

function extractAttr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  if (!match) return null;
  return match[2] ?? match[3] ?? match[4] ?? null;
}

function isIconRel(rel: string | null): boolean {
  if (!rel) return false;
  const tokens = rel.toLowerCase().split(/\s+/);
  return tokens.some((t) =>
    t === "icon" ||
    t === "shortcut" ||
    t === "apple-touch-icon" ||
    t === "apple-touch-icon-precomposed" ||
    t === "mask-icon"
  );
}

function parseIconLinks(html: string): IconCandidate[] {
  const candidates: IconCandidate[] = [];
  for (const [tag] of html.matchAll(ICON_LINK_REGEX)) {
    const rel = extractAttr(tag, "rel");
    if (!isIconRel(rel)) continue;
    const href = extractAttr(tag, "href");
    if (!href) continue;
    candidates.push({
      href,
      rel: rel!.toLowerCase(),
      sizes: extractAttr(tag, "sizes"),
      type: extractAttr(tag, "type"),
    });
  }
  return candidates;
}

function sizeScore(sizes: string | null): number {
  if (!sizes) return 0;
  let max = 0;
  for (const [, width, height] of sizes.matchAll(/(\d+)x(\d+)/gi)) {
    max = Math.max(max, Number(width) * Number(height));
  }
  return max;
}

/**
 * Ranks a page's declared icon <link> tags. A plain sizeless favicon.ico
 * link is usually declared first in source order but is the worst option,
 * so "best" means highest quality, not first-seen: SVG > largest declared
 * raster size > apple-touch-icon (conventionally ~180x180 with no sizes
 * attribute) > any other icon rel.
 */
function pickBestCandidate(candidates: IconCandidate[]): IconCandidate | null {
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestScore = scoreCandidate(best);
  for (const candidate of candidates.slice(1)) {
    const score = scoreCandidate(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function scoreCandidate(candidate: IconCandidate): number {
  if (candidate.type === "image/svg+xml" || candidate.href.endsWith(".svg")) {
    return Number.POSITIVE_INFINITY;
  }
  const bySize = sizeScore(candidate.sizes);
  if (bySize > 0) return bySize;
  if (candidate.rel.includes("apple-touch-icon")) return 32_400; // ~180x180
  return 1;
}

async function readBodyCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return await response.text();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
      if (total >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}

async function detectFromPage(target: URL, allowPrivateNetworks: boolean): Promise<string | null> {
  // Body-reading happens inside the same hard-timeout callback as the
  // fetch itself: fetch() resolving only means headers arrived, and a
  // server that stalls the body stream afterward would otherwise hang
  // past the 5s budget once the timeout race has already resolved.
  const page = await fetchWithHardTimeout(
    async (signal) => {
      const response = await ssrfSafeFetch(target.toString(), {
        method: "GET",
        signal,
        headers: { Accept: "text/html" },
        allowPrivateNetworks,
      });
      if (!response.ok) {
        if (response.body && !response.bodyUsed) {
          await response.body.cancel().catch(() => {});
        }
        return null;
      }
      return { html: await readBodyCapped(response, MAX_HTML_BYTES), finalUrl: response.url };
    },
    "Page fetch timed out",
    DETECT_TIMEOUT_MS
  );
  if (!page) return null;

  const candidates = parseIconLinks(page.html);
  const best = pickBestCandidate(candidates);
  if (!best) return null;

  try {
    return new URL(best.href, page.finalUrl || target.toString()).href;
  } catch {
    return null;
  }
}

async function detectFavicon(target: URL, allowPrivateNetworks: boolean): Promise<string | null> {
  const faviconUrl = new URL("/favicon.ico", target).href;
  try {
    const response = await fetchWithHardTimeout(
      async (signal) => {
        let res = await ssrfSafeFetch(faviconUrl, { method: "HEAD", signal, allowPrivateNetworks });
        // Some servers don't allow HEAD — fall back to GET, same as /api/ping.
        if (res.status === 405 || res.status === 501) {
          res = await ssrfSafeFetch(faviconUrl, { method: "GET", signal, allowPrivateNetworks });
        }
        return res;
      },
      "Favicon fetch timed out",
      DETECT_TIMEOUT_MS
    );
    // Neither branch below reads the body — only status/headers decide the
    // outcome — so cancel it rather than leave a possibly-large image
    // response (from the GET fallback) unread on the connection.
    if (response.body && !response.bodyUsed) {
      await response.body.cancel().catch(() => {});
    }
    if (response.status !== 200) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    return faviconUrl;
  } catch {
    return null;
  }
}

/**
 * Off by default: kokpit's core use case is detecting icons for LAN-only
 * self-hosted services, but shipping that reachable by default means any
 * caller who can hit this endpoint can also reach the rest of your private
 * network. Mirrors Heimdall's ALLOW_INTERNAL_REQUESTS — safe by default,
 * opt in if you want it. Cloud metadata addresses stay blocked either way
 * (see ssrfGuard.ts).
 */
function allowPrivateNetworksEnabled(): boolean {
  return process.env.KOKPIT_ICON_DETECT_ALLOW_PRIVATE_NETWORKS === "true";
}

/**
 * Detection order, from most to least reliable:
 *  1. The page's own declared <link rel="icon"> — the actual configured
 *     favicon, when the URL is reachable at all.
 *  2. /favicon.ico, same reachability requirement.
 *  3. The service's given name matched against dashboard-icons (curated
 *     for self-hosted homelab apps) then Simple Icons (general brands) —
 *     doesn't require the target URL to be reachable at all, which matters
 *     for services fronted by a VPN/tailnet the dashboard server itself
 *     isn't on.
 *  4. A hostname-derived guess (e.g. sonarr.example.com -> "sonarr")
 *     matched the same way — a common reverse-proxy subdomain-per-app
 *     convention, but kept as a last resort since a tile's name and its
 *     hostname aren't guaranteed to be related.
 */
export async function detectServiceIcon(
  rawUrl: string,
  name?: string
): Promise<IconDetectionResult> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return { icon: null, source: null };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { icon: null, source: null };
  }

  const allowPrivateNetworks = allowPrivateNetworksEnabled();

  try {
    const fromPage = await detectFromPage(target, allowPrivateNetworks);
    if (fromPage) return { icon: fromPage, source: "page" };
  } catch {
    // fall through to the next strategy
  }

  const favicon = await detectFavicon(target, allowPrivateNetworks);
  if (favicon) return { icon: favicon, source: "favicon" };

  if (name && name.trim() !== "") {
    const byName = await matchIconLibraries(name).catch(() => null);
    if (byName) return { icon: byName.url, source: byName.source };
  }

  for (const guess of guessNamesFromHostname(target.hostname)) {
    const byHostname = await matchIconLibraries(guess).catch(() => null);
    if (byHostname) return { icon: byHostname.url, source: byHostname.source };
  }

  return { icon: null, source: null };
}
