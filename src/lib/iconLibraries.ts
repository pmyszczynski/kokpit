import { fetchWithHardTimeout } from "@/lib/fetchTimeout";
import { ssrfSafeFetch } from "@/lib/ssrfGuard";

const FETCH_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const DASHBOARD_ICONS_METADATA_URL =
  "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/metadata.json";
const SIMPLE_ICONS_DATA_URL =
  "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@develop/data/simple-icons.json";

export type IconLibrarySource = "dashboard-icons" | "simple-icons";

interface LibraryEntry {
  slug: string;
  /** File extension to request, e.g. "svg" or "png". Only meaningful for dashboard-icons. */
  base: string;
}

interface LibraryIndex {
  byNormalizedName: Map<string, LibraryEntry>;
}

// Matching key: strip everything but letters/digits and lowercase, so
// "Nginx Proxy Manager", "nginx-proxy-manager", and "NginxProxyManager" all
// collapse to the same key. Homelab dashboard-icons entries aren't
// consistently hyphenated (e.g. the real slug is "filebrowser", not
// "file-browser"), so matching on the raw slug string would silently miss
// real entries — comparing fully-stripped forms sidesteps that.
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetchWithHardTimeout(
    (signal) => ssrfSafeFetch(url, { method: "GET", signal, allowPrivateNetworks: false }),
    "Icon index fetch timed out",
    FETCH_TIMEOUT_MS
  );
  if (!response.ok) {
    if (response.body && !response.bodyUsed) {
      await response.body.cancel().catch(() => {});
    }
    throw new Error(`Icon index fetch failed: ${response.status}`);
  }
  return response.json();
}

function makeCache(loader: () => Promise<LibraryIndex>) {
  let cached: { index: LibraryIndex; fetchedAt: number } | null = null;
  let inflight: Promise<LibraryIndex> | null = null;

  return async function load(): Promise<LibraryIndex> {
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.index;
    }
    if (inflight) return inflight;

    inflight = loader()
      .then((index) => {
        cached = { index, fetchedAt: Date.now() };
        return index;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}

interface DashboardIconMetaEntry {
  base?: string;
  aliases?: string[];
}

const loadDashboardIcons = makeCache(async () => {
  const data = (await fetchJson(DASHBOARD_ICONS_METADATA_URL)) as Record<
    string,
    DashboardIconMetaEntry
  >;
  const byNormalizedName = new Map<string, LibraryEntry>();
  // Canonical slugs first, so an alias can never shadow another icon's
  // direct name match.
  for (const [slug, meta] of Object.entries(data)) {
    const key = normalizeName(slug);
    if (key) byNormalizedName.set(key, { slug, base: meta.base || "svg" });
  }
  for (const [slug, meta] of Object.entries(data)) {
    for (const alias of meta.aliases ?? []) {
      const key = normalizeName(alias);
      if (key && !byNormalizedName.has(key)) {
        byNormalizedName.set(key, { slug, base: meta.base || "svg" });
      }
    }
  }
  return { byNormalizedName };
});

interface SimpleIconEntry {
  title: string;
  aliases?: { aka?: string[] };
}

const loadSimpleIcons = makeCache(async () => {
  const data = (await fetchJson(SIMPLE_ICONS_DATA_URL)) as SimpleIconEntry[];
  const byNormalizedName = new Map<string, LibraryEntry>();
  for (const item of data) {
    // The CDN slug is derived from the title via Simple Icons' own
    // slugification, which we don't replicate exactly (it has special
    // handling for a handful of characters) — this is a best-effort
    // candidate, verified with a HEAD request before ever being returned.
    const slug = normalizeName(item.title);
    if (!slug) continue;
    const entry: LibraryEntry = { slug, base: "svg" };
    const titleKey = normalizeName(item.title);
    if (titleKey && !byNormalizedName.has(titleKey)) byNormalizedName.set(titleKey, entry);
    for (const alias of item.aliases?.aka ?? []) {
      const key = normalizeName(alias);
      if (key && !byNormalizedName.has(key)) byNormalizedName.set(key, entry);
    }
  }
  return { byNormalizedName };
});

async function verifyIconUrl(url: string): Promise<boolean> {
  try {
    const response = await fetchWithHardTimeout(
      (signal) => ssrfSafeFetch(url, { method: "HEAD", signal, allowPrivateNetworks: false }),
      "Icon verification timed out",
      FETCH_TIMEOUT_MS
    );
    if (response.body && !response.bodyUsed) {
      await response.body.cancel().catch(() => {});
    }
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Matches a candidate name (a service's display name, or a hostname-derived
 * guess) against dashboard-icons first, then Simple Icons. dashboard-icons
 * is checked first because it's curated specifically for self-hosted
 * homelab apps — the audience this feature is for — while Simple Icons is
 * general tech/company brands.
 */
export async function matchIconLibraries(
  candidateName: string
): Promise<{ url: string; source: IconLibrarySource } | null> {
  const key = normalizeName(candidateName);
  if (!key) return null;

  const dashboardIndex = await loadDashboardIcons().catch(() => null);
  const dashboardEntry = dashboardIndex?.byNormalizedName.get(key);
  if (dashboardEntry) {
    const url = `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/${dashboardEntry.base}/${dashboardEntry.slug}.${dashboardEntry.base}`;
    return { url, source: "dashboard-icons" };
  }

  const simpleIndex = await loadSimpleIcons().catch(() => null);
  const simpleEntry = simpleIndex?.byNormalizedName.get(key);
  if (simpleEntry) {
    const url = `https://cdn.simpleicons.org/${simpleEntry.slug}`;
    if (await verifyIconUrl(url)) return { url, source: "simple-icons" };
  }

  return null;
}

/**
 * Derives rough "app name" guesses from a hostname for the last-resort
 * fallback tier, trying two different conventions since they disagree on
 * which label is the interesting one:
 *  - Reverse-proxy subdomain-per-app (the dominant pattern for self-hosted
 *    homelab setups): sonarr.example.com -> "sonarr" (the leftmost label).
 *  - Public SaaS brand domain: app.plex.tv -> "plex" (the label just
 *    before the TLD, skipping a leading "www"/subdomain prefix) — this
 *    would otherwise guess "app" instead of "plex".
 * Ordered leftmost-label first, since that's the more common shape for
 * kokpit's actual audience. Deliberately weak either way — only used
 * after every other, more reliable signal (page/favicon fetch, and
 * matching on the service's actual given name) has failed.
 */
export function guessNamesFromHostname(hostname: string): string[] {
  const parts = hostname.toLowerCase().split(".").filter(Boolean);
  if (parts.length < 2) return [];

  const guesses: string[] = [];
  const isValid = (s: string | undefined): s is string => !!s && /^[a-z0-9-]+$/.test(s);

  const leftmost = parts[0];
  if (leftmost !== "www" && isValid(leftmost)) guesses.push(leftmost);

  const withoutTld = parts.slice(0, -1);
  const withoutWww = withoutTld[0] === "www" ? withoutTld.slice(1) : withoutTld;
  const brandGuess = withoutWww[withoutWww.length - 1];
  if (isValid(brandGuess) && brandGuess !== leftmost) guesses.push(brandGuess);

  return guesses;
}
