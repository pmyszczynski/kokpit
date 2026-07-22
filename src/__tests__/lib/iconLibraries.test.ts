// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const ssrfSafeFetchMock = vi.fn();
vi.mock("@/lib/ssrfGuard", () => ({
  ssrfSafeFetch: (...args: unknown[]) => ssrfSafeFetchMock(...args),
}));

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: undefined,
    json: () => Promise.resolve(data),
  };
}

function plainResponse(status: number) {
  return { ok: status >= 200 && status < 300, status, body: undefined };
}

const DASHBOARD_ICONS_URL = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/metadata.json";
const SIMPLE_ICONS_URL =
  "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons@develop/data/simple-icons.json";
const SELFHST_URL = "https://cdn.jsdelivr.net/gh/selfhst/icons/index.json";

const SAMPLE_DASHBOARD_ICONS = {
  arcane: { base: "svg", aliases: [] },
  filebrowser: { base: "svg", aliases: [] },
  "nginx-proxy-manager": { base: "svg", aliases: ["Reverse Proxy UI"] },
  sonarr: { base: "png", aliases: [] },
};

const SAMPLE_SIMPLE_ICONS = [
  { title: "Docker", aliases: undefined },
  { title: ".ENV", aliases: { aka: ["Dotenv"] } },
  // A real Simple Icons disambiguation case: the auto-slugified title would
  // collide with something else, so the data declares an explicit slug.
  { title: "Graphite", slug: "graphite_editor", aliases: undefined },
];

const SAMPLE_SELFHST_ICONS = [
  { Name: "Sonarr", Reference: "sonarr", SVG: "Yes" },
  { Name: "Uptime Kuma", Reference: "uptime-kuma", SVG: "Yes" },
  // Exactly matches the query "son" while "Sonarr" only prefix-matches it —
  // lets a ranking test assert exact beats prefix.
  { Name: "Son", Reference: "son", SVG: "Yes" },
  // SVG: "No" — has no svg asset, so it can't be a `sh-` shorthand and must
  // be skipped by the loader.
  { Name: "Png Only", Reference: "png-only", SVG: "No" },
];

function mockDashboardIconsFetch(data = SAMPLE_DASHBOARD_ICONS) {
  ssrfSafeFetchMock.mockImplementation(async (url: string) => {
    if (url === DASHBOARD_ICONS_URL) return jsonResponse(data);
    if (url === SIMPLE_ICONS_URL) return jsonResponse(SAMPLE_SIMPLE_ICONS);
    if (url === SELFHST_URL) return jsonResponse(SAMPLE_SELFHST_ICONS);
    return plainResponse(200);
  });
}

function mockAllLibraries() {
  ssrfSafeFetchMock.mockImplementation(async (url: string) => {
    if (url === DASHBOARD_ICONS_URL) return jsonResponse(SAMPLE_DASHBOARD_ICONS);
    if (url === SIMPLE_ICONS_URL) return jsonResponse(SAMPLE_SIMPLE_ICONS);
    if (url === SELFHST_URL) return jsonResponse(SAMPLE_SELFHST_ICONS);
    return plainResponse(200);
  });
}

// Each test gets its own fresh module instance -- the index cache lives at
// module scope with a 24h TTL, so reusing one import across tests would let
// an earlier test's successful fetch silently mask a later test's mocked
// failure/response.
async function freshModule() {
  vi.resetModules();
  return import("@/lib/iconLibraries");
}

beforeEach(() => {
  ssrfSafeFetchMock.mockReset();
});

describe("guessNamesFromHostname", () => {
  it("guesses the leftmost label first (reverse-proxy subdomain-per-app convention)", async () => {
    const { guessNamesFromHostname } = await freshModule();
    expect(guessNamesFromHostname("sonarr.example.com")).toEqual(["sonarr", "example"]);
  });

  it("also offers the pre-TLD label as a second guess (public SaaS brand domain convention)", async () => {
    const { guessNamesFromHostname } = await freshModule();
    expect(guessNamesFromHostname("app.plex.tv")).toEqual(["app", "plex"]);
  });

  it("excludes a leading www from the leftmost guess", async () => {
    const { guessNamesFromHostname } = await freshModule();
    expect(guessNamesFromHostname("www.example.com")).toEqual(["example"]);
  });

  it("dedupes when both conventions land on the same label", async () => {
    const { guessNamesFromHostname } = await freshModule();
    expect(guessNamesFromHostname("example.com")).toEqual(["example"]);
  });

  it("doesn't produce a name related to the app for a Tailscale-style hostname", async () => {
    // This is the real motivating case: neither guess is "arcane" here,
    // which is expected -- hostname-guessing can't solve this, that's what
    // name-based matching is for. Just confirming it degrades sensibly
    // rather than crashing or guessing something wild.
    const { guessNamesFromHostname } = await freshModule();
    expect(guessNamesFromHostname("towarcloud.worm-marlin.ts.net")).toEqual([
      "towarcloud",
      "ts",
    ]);
  });

  it("returns no guesses for a single-label hostname", async () => {
    const { guessNamesFromHostname } = await freshModule();
    expect(guessNamesFromHostname("localhost")).toEqual([]);
  });
});

describe("matchIconLibraries", () => {
  it("returns null for an empty or whitespace-only candidate", async () => {
    const { matchIconLibraries } = await freshModule();
    expect(await matchIconLibraries("")).toBeNull();
    expect(await matchIconLibraries("   ")).toBeNull();
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("matches a dashboard-icons canonical slug directly", async () => {
    mockDashboardIconsFetch();
    const { matchIconLibraries } = await freshModule();
    const result = await matchIconLibraries("Arcane");
    expect(result).toEqual({
      url: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/arcane.svg",
      source: "dashboard-icons",
    });
  });

  it("matches regardless of spacing/hyphenation differences from the real slug", async () => {
    mockDashboardIconsFetch();
    const { matchIconLibraries } = await freshModule();
    // The real dashboard-icons slug is "filebrowser" (no hyphen) -- a naive
    // hyphenated guess from "File Browser" would miss it; normalized
    // matching should not.
    const result = await matchIconLibraries("File Browser");
    expect(result).toEqual({
      url: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/filebrowser.svg",
      source: "dashboard-icons",
    });
  });

  it("matches a dashboard-icons alias", async () => {
    mockDashboardIconsFetch();
    const { matchIconLibraries } = await freshModule();
    const result = await matchIconLibraries("Reverse Proxy UI");
    expect(result).toEqual({
      url: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/nginx-proxy-manager.svg",
      source: "dashboard-icons",
    });
  });

  it("uses each entry's own declared format extension", async () => {
    mockDashboardIconsFetch();
    const { matchIconLibraries } = await freshModule();
    const result = await matchIconLibraries("sonarr");
    expect(result?.url).toBe(
      "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/sonarr.png"
    );
  });

  it("does not verify a dashboard-icons match with an extra network call", async () => {
    mockDashboardIconsFetch();
    const { matchIconLibraries } = await freshModule();
    await matchIconLibraries("Arcane");
    // Exactly one call: the metadata.json fetch. The published index is
    // trusted directly, unlike the best-effort Simple Icons slug guess.
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to Simple Icons when dashboard-icons has no match", async () => {
    mockDashboardIconsFetch();
    const { matchIconLibraries } = await freshModule();
    const result = await matchIconLibraries("Docker");
    expect(result).toEqual({ url: "https://cdn.simpleicons.org/docker", source: "simple-icons" });
  });

  it("matches a Simple Icons alias (aka)", async () => {
    mockDashboardIconsFetch();
    const { matchIconLibraries } = await freshModule();
    const result = await matchIconLibraries("Dotenv");
    expect(result).toEqual({ url: "https://cdn.simpleicons.org/env", source: "simple-icons" });
  });

  it("verifies the Simple Icons candidate before returning it, and rejects it if it 404s", async () => {
    ssrfSafeFetchMock.mockImplementation(async (url: string, opts: { method: string }) => {
      if (url === DASHBOARD_ICONS_URL) return jsonResponse(SAMPLE_DASHBOARD_ICONS);
      if (url === SIMPLE_ICONS_URL) return jsonResponse(SAMPLE_SIMPLE_ICONS);
      if (opts.method === "HEAD") return plainResponse(404);
      return plainResponse(200);
    });
    const { matchIconLibraries } = await freshModule();
    const result = await matchIconLibraries("Docker");
    expect(result).toBeNull();
  });

  it("returns null when nothing matches in either library", async () => {
    mockDashboardIconsFetch();
    const { matchIconLibraries } = await freshModule();
    const result = await matchIconLibraries("Something Totally Unknown");
    expect(result).toBeNull();
  });

  it("caches the fetched indices across multiple calls", async () => {
    mockDashboardIconsFetch();
    const { matchIconLibraries } = await freshModule();
    await matchIconLibraries("Arcane");
    await matchIconLibraries("sonarr");
    await matchIconLibraries("filebrowser");
    // One fetch per index, ever, not once per call.
    const dashboardCalls = ssrfSafeFetchMock.mock.calls.filter(
      ([url]) => url === DASHBOARD_ICONS_URL
    );
    expect(dashboardCalls).toHaveLength(1);
  });

  it("degrades to Simple Icons (and eventually null) when the dashboard-icons fetch fails", async () => {
    ssrfSafeFetchMock.mockImplementation(async (url: string) => {
      if (url === DASHBOARD_ICONS_URL) return plainResponse(500);
      if (url === SIMPLE_ICONS_URL) return jsonResponse(SAMPLE_SIMPLE_ICONS);
      return plainResponse(200);
    });
    const { matchIconLibraries } = await freshModule();
    const result = await matchIconLibraries("Docker");
    expect(result).toEqual({ url: "https://cdn.simpleicons.org/docker", source: "simple-icons" });
  });

  it("returns null (not a throw) when both index fetches fail", async () => {
    ssrfSafeFetchMock.mockRejectedValue(new Error("network down"));
    const { matchIconLibraries } = await freshModule();
    const result = await matchIconLibraries("Arcane");
    expect(result).toBeNull();
  });

  it("uses a Simple Icons entry's explicit slug instead of the title-derived one", async () => {
    mockDashboardIconsFetch();
    const { matchIconLibraries } = await freshModule();
    const result = await matchIconLibraries("Graphite");
    // Not "graphite" -- the naive title-derived slug -- since the data
    // declares an explicit "graphite_editor" to disambiguate.
    expect(result).toEqual({
      url: "https://cdn.simpleicons.org/graphite_editor",
      source: "simple-icons",
    });
  });

  it("also matches a Simple Icons candidate on its explicit slug directly", async () => {
    mockDashboardIconsFetch();
    const { matchIconLibraries } = await freshModule();
    const result = await matchIconLibraries("graphite_editor");
    expect(result).toEqual({
      url: "https://cdn.simpleicons.org/graphite_editor",
      source: "simple-icons",
    });
  });

  it("backs off after a failed index load instead of retrying immediately", async () => {
    vi.useFakeTimers();
    try {
      ssrfSafeFetchMock.mockImplementation(async (url: string) => {
        if (url === DASHBOARD_ICONS_URL) return plainResponse(500);
        if (url === SIMPLE_ICONS_URL) return jsonResponse(SAMPLE_SIMPLE_ICONS);
        return plainResponse(200);
      });
      const { matchIconLibraries } = await freshModule();

      await matchIconLibraries("Arcane");
      await matchIconLibraries("sonarr");
      const dashboardCallsBeforeBackoff = ssrfSafeFetchMock.mock.calls.filter(
        ([url]) => url === DASHBOARD_ICONS_URL
      );
      // One failed attempt, not one per candidate -- the second call should
      // have backed off rather than retrying the CDN immediately.
      expect(dashboardCallsBeforeBackoff).toHaveLength(1);

      vi.setSystemTime(Date.now() + 61_000);
      await matchIconLibraries("filebrowser");
      const dashboardCallsAfterBackoff = ssrfSafeFetchMock.mock.calls.filter(
        ([url]) => url === DASHBOARD_ICONS_URL
      );
      // Once the backoff window passes, a retry is attempted again.
      expect(dashboardCallsAfterBackoff).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("searchIconLibraries", () => {
  it("returns nothing for an empty or whitespace query without touching the network", async () => {
    mockAllLibraries();
    const { searchIconLibraries } = await freshModule();
    expect(await searchIconLibraries("")).toEqual([]);
    expect(await searchIconLibraries("   ")).toEqual([]);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("returns shorthand refs for dashboard-icons and selfh.st, and a URL for Simple Icons", async () => {
    mockAllLibraries();
    const { searchIconLibraries } = await freshModule();

    const [di] = await searchIconLibraries("filebrowser");
    expect(di).toMatchObject({
      ref: "di-filebrowser",
      source: "dashboard-icons",
      url: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/filebrowser.svg",
    });

    const [sh] = await searchIconLibraries("uptime kuma");
    expect(sh).toMatchObject({ ref: "sh-uptime-kuma", source: "selfhst" });

    const [si] = await searchIconLibraries("docker");
    expect(si).toMatchObject({
      ref: "https://cdn.simpleicons.org/docker",
      source: "simple-icons",
    });
  });

  it("uses a full URL ref (not a di- shorthand) for a png-only dashboard icon", async () => {
    mockAllLibraries();
    const { searchIconLibraries } = await freshModule();
    const [entry] = await searchIconLibraries("sonarr");
    // The `di-` shorthand always expands to svg, so a png-only entry must
    // store its full CDN url instead.
    expect(entry).toMatchObject({
      source: "dashboard-icons",
      ref: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/sonarr.png",
    });
  });

  it("ranks an exact name match above a prefix match", async () => {
    mockAllLibraries();
    const { searchIconLibraries } = await freshModule();
    const results = await searchIconLibraries("son");
    expect(results[0].name).toBe("Son"); // exact
    expect(results[1].name).toBe("Sonarr"); // prefix
  });

  it("ranks a prefix match above a substring match", async () => {
    mockAllLibraries();
    const { searchIconLibraries } = await freshModule();
    const results = await searchIconLibraries("n");
    // "Nginx Proxy Manager" starts with n (prefix); the rest only contain it.
    expect(results[0].name).toBe("Nginx Proxy Manager");
  });

  it("dedupes the same-named icon across sources, keeping the homelab-curated one", async () => {
    mockAllLibraries();
    const { searchIconLibraries } = await freshModule();
    const results = await searchIconLibraries("sonarr");
    const sonarrs = results.filter((r) => r.name === "Sonarr");
    // dashboard-icons and selfh.st both have Sonarr; only one survives, and
    // it's the dashboard-icons one (higher source priority).
    expect(sonarrs).toHaveLength(1);
    expect(sonarrs[0].source).toBe("dashboard-icons");
  });

  it("honors the result limit", async () => {
    mockAllLibraries();
    const { searchIconLibraries } = await freshModule();
    const results = await searchIconLibraries("n", 1);
    expect(results).toHaveLength(1);
  });

  it("skips a selfh.st entry that has no svg asset", async () => {
    mockAllLibraries();
    const { searchIconLibraries } = await freshModule();
    const results = await searchIconLibraries("png only");
    expect(results).toHaveLength(0);
  });

  it("still returns results from the surviving sources when one index fetch fails", async () => {
    ssrfSafeFetchMock.mockImplementation(async (url: string) => {
      if (url === DASHBOARD_ICONS_URL) return plainResponse(500);
      if (url === SIMPLE_ICONS_URL) return jsonResponse(SAMPLE_SIMPLE_ICONS);
      if (url === SELFHST_URL) return jsonResponse(SAMPLE_SELFHST_ICONS);
      return plainResponse(200);
    });
    const { searchIconLibraries } = await freshModule();
    const results = await searchIconLibraries("uptime kuma");
    expect(results[0]).toMatchObject({ ref: "sh-uptime-kuma", source: "selfhst" });
  });
});
