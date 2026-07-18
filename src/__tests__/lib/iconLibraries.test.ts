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

const SAMPLE_DASHBOARD_ICONS = {
  arcane: { base: "svg", aliases: [] },
  filebrowser: { base: "svg", aliases: [] },
  "nginx-proxy-manager": { base: "svg", aliases: ["Reverse Proxy UI"] },
  sonarr: { base: "png", aliases: [] },
};

const SAMPLE_SIMPLE_ICONS = [
  { title: "Docker", aliases: undefined },
  { title: ".ENV", aliases: { aka: ["Dotenv"] } },
];

function mockDashboardIconsFetch(data = SAMPLE_DASHBOARD_ICONS) {
  ssrfSafeFetchMock.mockImplementation(async (url: string) => {
    if (url === DASHBOARD_ICONS_URL) return jsonResponse(data);
    if (url === SIMPLE_ICONS_URL) return jsonResponse(SAMPLE_SIMPLE_ICONS);
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
});
