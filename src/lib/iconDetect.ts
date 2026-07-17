import { fetchWithHardTimeout } from "@/lib/fetchTimeout";

const DETECT_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 100_000;

export type IconSource = "page" | "favicon" | "simple-icons";

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

async function detectFromPage(target: URL): Promise<string | null> {
  // Body-reading happens inside the same hard-timeout callback as the
  // fetch itself: fetch() resolving only means headers arrived, and a
  // server that stalls the body stream afterward would otherwise hang
  // past the 5s budget once the timeout race has already resolved.
  const page = await fetchWithHardTimeout(
    async (signal) => {
      const response = await fetch(target.toString(), {
        method: "GET",
        signal,
        redirect: "follow",
        headers: { Accept: "text/html" },
      });
      if (!response.ok) return null;
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

async function detectFavicon(target: URL): Promise<string | null> {
  const faviconUrl = new URL("/favicon.ico", target).href;
  try {
    const response = await fetchWithHardTimeout(
      async (signal) => {
        let res = await fetch(faviconUrl, { method: "HEAD", signal, redirect: "follow" });
        // Some servers don't allow HEAD — fall back to GET, same as /api/ping.
        if (res.status === 405 || res.status === 501) {
          res = await fetch(faviconUrl, { method: "GET", signal, redirect: "follow" });
        }
        return res;
      },
      "Favicon fetch timed out",
      DETECT_TIMEOUT_MS
    );
    if (response.status !== 200) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    return faviconUrl;
  } catch {
    return null;
  }
}

function guessSimpleIconsSlug(hostname: string): string | null {
  const parts = hostname.toLowerCase().split(".").filter(Boolean);
  if (parts.length < 2) return null;
  // Drop the TLD (and a leading "www"): app.plex.tv -> plex
  const withoutTld = parts.slice(0, -1);
  const withoutWww = withoutTld[0] === "www" ? withoutTld.slice(1) : withoutTld;
  const slug = withoutWww[withoutWww.length - 1];
  return slug && /^[a-z0-9-]+$/.test(slug) ? slug : null;
}

async function detectSimpleIcons(target: URL): Promise<string | null> {
  const slug = guessSimpleIconsSlug(target.hostname);
  if (!slug) return null;
  const iconUrl = `https://cdn.simpleicons.org/${slug}`;
  try {
    const response = await fetchWithHardTimeout(
      (signal) => fetch(iconUrl, { method: "HEAD", signal, redirect: "follow" }),
      "Simple Icons fetch timed out",
      DETECT_TIMEOUT_MS
    );
    return response.status === 200 ? iconUrl : null;
  } catch {
    return null;
  }
}

// Cloud instance-metadata endpoints hand out credentials to anything
// running on the host, no auth required — there is no scenario where one
// is a legitimate "my self-hosted service" icon target, so blocking them
// costs nothing. Deliberately narrow beyond that: no loopback or private-
// LAN blocking, since kokpit and a target service commonly share a host
// (NAS/homelab setups binding multiple apps to 127.0.0.1) and reaching
// the LAN at all is the entire point of the feature. Only checks the
// initial host, not redirect targets.
const BLOCKED_HOSTNAMES = new Set([
  "169.254.169.254", // AWS / GCP / Azure / DigitalOcean metadata
  "100.100.100.200", // Alibaba Cloud metadata
  "metadata.google.internal", // GCP metadata (alternate hostname)
  "[fd00:ec2::254]", // AWS IMDSv2, IPv6
]);

function isBlockedTarget(target: URL): boolean {
  return BLOCKED_HOSTNAMES.has(target.hostname.toLowerCase());
}

export async function detectServiceIcon(rawUrl: string): Promise<IconDetectionResult> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return { icon: null, source: null };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { icon: null, source: null };
  }
  if (isBlockedTarget(target)) {
    return { icon: null, source: null };
  }

  try {
    const fromPage = await detectFromPage(target);
    if (fromPage) return { icon: fromPage, source: "page" };
  } catch {
    // fall through to the next strategy
  }

  const favicon = await detectFavicon(target);
  if (favicon) return { icon: favicon, source: "favicon" };

  const simpleIcon = await detectSimpleIcons(target);
  if (simpleIcon) return { icon: simpleIcon, source: "simple-icons" };

  return { icon: null, source: null };
}
