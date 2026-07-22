import { fetchWithHardTimeout } from "@/lib/fetchTimeout";
import { ssrfSafeFetch } from "@/lib/ssrfGuard";

const FETCH_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const DASHBOARD_ICONS_METADATA_URL =
  "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/metadata.json";
const SIMPLE_ICONS_DATA_URL =
  "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@develop/data/simple-icons.json";
const SELFHST_INDEX_URL = "https://cdn.jsdelivr.net/gh/selfhst/icons/index.json";

export type IconLibrarySource = "dashboard-icons" | "simple-icons" | "selfhst";

interface LibraryEntry {
  slug: string;
  /** File extension to request, e.g. "svg" or "png". Only meaningful for dashboard-icons. */
  base: string;
}

/** A single browsable icon, as returned by searchIconLibraries. */
export interface IconSearchResult {
  /**
   * The value stored in the config `icon` field when this icon is picked:
   * a `sh-`/`di-` shorthand where one exists (so YAML stays short and
   * CDN-path-independent), or a full CDN URL for sources without a shorthand.
   */
  ref: string;
  /** Human-readable display name. */
  name: string;
  /** Resolved preview URL. */
  url: string;
  source: IconLibrarySource;
}

/** Search entry with the extra normalized keys used for ranking/dedup. */
interface IndexedSearchEntry extends IconSearchResult {
  /** Normalized display name, for exact/prefix/substring ranking. */
  nameKey: string;
  /** Normalized alias/slug keys, for the lowest-priority match tier. */
  aliasKeys: string[];
}

interface LibraryIndex {
  byNormalizedName: Map<string, LibraryEntry>;
  search: IndexedSearchEntry[];
}

// Turns a hyphen/underscore slug into a display name ("nginx-proxy-manager" ->
// "Nginx Proxy Manager"). dashboard-icons keys are slugs with no separate
// pretty name, so this is the best available label for the picker.
function titleizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
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
  // Body parsing happens inside the same hard-timeout callback as the fetch
  // itself, same reasoning as detectFromPage in iconDetect.ts: fetch()
  // resolving only means headers arrived, and a server that stalls the body
  // stream afterward would otherwise hang past the timeout budget once the
  // race has already resolved.
  return fetchWithHardTimeout(
    async (signal) => {
      const response = await ssrfSafeFetch(url, {
        method: "GET",
        signal,
        allowPrivateNetworks: false,
      });
      if (!response.ok) {
        if (response.body && !response.bodyUsed) {
          await response.body.cancel().catch(() => {});
        }
        throw new Error(`Icon index fetch failed: ${response.status}`);
      }
      return response.json();
    },
    "Icon index fetch timed out",
    FETCH_TIMEOUT_MS
  );
}

// A failed load is remembered for a short backoff window rather than retried
// immediately: a single detection attempt can call load() up to three times
// in a row (name guess + two hostname guesses), and without this an outage
// would pay the full fetch timeout on every one of those instead of once.
const FAILURE_BACKOFF_MS = 60_000;

function makeCache(loader: () => Promise<LibraryIndex>) {
  let cached: { index: LibraryIndex; fetchedAt: number } | null = null;
  let inflight: Promise<LibraryIndex> | null = null;
  let failedAt: number | null = null;

  return async function load(): Promise<LibraryIndex> {
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.index;
    }
    if (inflight) return inflight;
    if (failedAt !== null && Date.now() - failedAt < FAILURE_BACKOFF_MS) {
      throw new Error("Icon index load recently failed, backing off");
    }

    inflight = loader()
      .then((index) => {
        cached = { index, fetchedAt: Date.now() };
        failedAt = null;
        return index;
      })
      .catch((err) => {
        failedAt = Date.now();
        throw err;
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
  const search: IndexedSearchEntry[] = [];
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
  for (const [slug, meta] of Object.entries(data)) {
    const key = normalizeName(slug);
    if (!key) continue;
    const base = meta.base || "svg";
    const url = `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/${base}/${slug}.${base}`;
    // Only svg icons get the `di-` shorthand (it always expands to the svg
    // path); png-only entries store the full CDN url so they still resolve.
    const ref = base === "svg" ? `di-${slug}` : url;
    const name = titleizeSlug(slug);
    search.push({
      ref,
      name,
      url,
      source: "dashboard-icons",
      nameKey: normalizeName(name),
      aliasKeys: [key, ...(meta.aliases ?? []).map(normalizeName).filter(Boolean)],
    });
  }
  return { byNormalizedName, search };
});

interface SimpleIconEntry {
  title: string;
  slug?: string;
  aliases?: { aka?: string[] };
}

const loadSimpleIcons = makeCache(async () => {
  const data = (await fetchJson(SIMPLE_ICONS_DATA_URL)) as SimpleIconEntry[];
  const byNormalizedName = new Map<string, LibraryEntry>();
  const search: IndexedSearchEntry[] = [];
  for (const item of data) {
    // A handful of entries declare an explicit `slug` that overrides the
    // title-derived one, used when the auto-slugified title would collide
    // with another icon (e.g. "Graphite" -> "graphite_editor", not
    // "graphite"). Falling back to the normalized title otherwise is still
    // only a best-effort match of Simple Icons' own slugification — verified
    // with a HEAD request before ever being returned.
    const slug = item.slug || normalizeName(item.title);
    if (!slug) continue;
    const entry: LibraryEntry = { slug, base: "svg" };
    const titleKey = normalizeName(item.title);
    if (titleKey && !byNormalizedName.has(titleKey)) byNormalizedName.set(titleKey, entry);
    // Also index the slug itself: a divergent explicit slug (e.g.
    // "graphite_editor") is itself a reasonable thing for a hostname guess
    // or a user-typed name to match against, separately from the title.
    const slugKey = normalizeName(slug);
    if (slugKey && !byNormalizedName.has(slugKey)) byNormalizedName.set(slugKey, entry);
    for (const alias of item.aliases?.aka ?? []) {
      const key = normalizeName(alias);
      if (key && !byNormalizedName.has(key)) byNormalizedName.set(key, entry);
    }
    // Simple Icons has no shorthand prefix in resolveIconRef; the picker
    // stores the stable cdn.simpleicons.org URL, which passes through
    // unchanged.
    const url = `https://cdn.simpleicons.org/${slug}`;
    search.push({
      ref: url,
      name: item.title,
      url,
      source: "simple-icons",
      nameKey: titleKey,
      aliasKeys: [
        slugKey,
        ...(item.aliases?.aka ?? []).map(normalizeName).filter(Boolean),
      ],
    });
  }
  return { byNormalizedName, search };
});

interface SelfhstIndexEntry {
  Name?: string;
  Reference?: string;
  SVG?: string;
}

// selfh.st publishes a flat index.json: an array of { Name, Reference, SVG,
// … } records. Only used for search; matchIconLibraries doesn't consult it.
const loadSelfhst = makeCache(async () => {
  const data = (await fetchJson(SELFHST_INDEX_URL)) as SelfhstIndexEntry[];
  const byNormalizedName = new Map<string, LibraryEntry>();
  const search: IndexedSearchEntry[] = [];
  for (const item of Array.isArray(data) ? data : []) {
    const slug = item.Reference;
    const name = item.Name;
    // The `sh-` shorthand expands to the svg path, so an entry without an svg
    // asset can't be represented as a shorthand — skip it.
    if (!slug || !name || item.SVG !== "Yes") continue;
    const slugKey = normalizeName(slug);
    if (!slugKey) continue;
    const url = `https://cdn.jsdelivr.net/gh/selfhst/icons/svg/${slug}.svg`;
    if (!byNormalizedName.has(slugKey)) {
      byNormalizedName.set(slugKey, { slug, base: "svg" });
    }
    search.push({
      ref: `sh-${slug}`,
      name,
      url,
      source: "selfhst",
      nameKey: normalizeName(name),
      aliasKeys: [slugKey],
    });
  }
  return { byNormalizedName, search };
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
): Promise<{ url: string; source: "dashboard-icons" | "simple-icons" } | null> {
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
// Lower rank = better match. null means the entry doesn't match at all.
function rankEntry(entry: IndexedSearchEntry, queryKey: string): number | null {
  if (entry.nameKey === queryKey) return 0;
  if (entry.nameKey.startsWith(queryKey)) return 1;
  if (entry.nameKey.includes(queryKey)) return 2;
  if (entry.aliasKeys.some((key) => key.includes(queryKey))) return 3;
  return null;
}

// When two sources carry the same-named icon, prefer the homelab-curated ones
// (dashboard-icons, then selfh.st) over the general-purpose Simple Icons —
// same rationale as matchIconLibraries' source ordering.
const SOURCE_PRIORITY: Record<IconLibrarySource, number> = {
  "dashboard-icons": 0,
  selfhst: 1,
  "simple-icons": 2,
};

/**
 * Searches all three icon libraries for a user-typed query and returns ranked,
 * de-duplicated results for the icon picker. Ranking: exact display-name match
 * > name prefix > name substring > alias/slug substring; ties broken by source
 * priority then name. Entries sharing a normalized display name are collapsed
 * to the highest-priority source. Returns at most `limit` results (default 30).
 * An empty/whitespace query returns nothing without touching the network.
 */
export async function searchIconLibraries(
  query: string,
  limit = 30
): Promise<IconSearchResult[]> {
  const queryKey = normalizeName(query);
  if (!queryKey) return [];

  const [dashboard, simple, selfhst] = await Promise.all([
    loadDashboardIcons().catch(() => null),
    loadSimpleIcons().catch(() => null),
    loadSelfhst().catch(() => null),
  ]);

  const scored: { entry: IndexedSearchEntry; rank: number }[] = [];
  for (const index of [dashboard, selfhst, simple]) {
    if (!index) continue;
    for (const entry of index.search) {
      const rank = rankEntry(entry, queryKey);
      if (rank !== null) scored.push({ entry, rank });
    }
  }

  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      SOURCE_PRIORITY[a.entry.source] - SOURCE_PRIORITY[b.entry.source] ||
      a.entry.name.localeCompare(b.entry.name)
  );

  const seen = new Set<string>();
  const results: IconSearchResult[] = [];
  for (const { entry } of scored) {
    if (seen.has(entry.nameKey)) continue;
    seen.add(entry.nameKey);
    results.push({ ref: entry.ref, name: entry.name, url: entry.url, source: entry.source });
    if (results.length >= limit) break;
  }
  return results;
}

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
