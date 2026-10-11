// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearRegistry } from "@/widgets";
import { fetchPlexSessions, fetchPlexLibraries } from "@/integrations/plex/api";
import type { PlexData } from "@/integrations/plex/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
}

// ---------------------------------------------------------------------------
// fetchPlexSessions
// ---------------------------------------------------------------------------

describe("fetchPlexSessions", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  const baseConfig = {
    url: "http://plex.local:32400",
    token: "mytoken",
    fields: ["streams", "transcodes", "lan_streams", "remote_streams", "users", "bandwidth"] as const,
  };

  it("returns correct streams, transcodes, lan/remote split, users and bandwidth", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch({
        MediaContainer: {
          size: 3,
          Metadata: [
            { TranscodeSession: {}, Session: { location: "lan", bandwidth: 4000 }, User: { title: "Alice" } },
            { Session: { location: "wan", bandwidth: 2000 }, User: { title: "Bob" } },
            { TranscodeSession: {}, Session: { location: "lan", bandwidth: 1000 }, User: { title: "Alice" } },
          ],
        },
      })
    );

    const result = await fetchPlexSessions({ ...baseConfig, fields: [...baseConfig.fields] });
    expect(result.streams).toBe(3);
    expect(result.transcodes).toBe(2);
    expect(result.lan_streams).toBe(2);
    expect(result.remote_streams).toBe(1);
    expect(result.users).toBe(2); // Alice + Bob
    expect(result.bandwidth).toBe(7000);
  });

  it("returns all zeros when Metadata is absent", async () => {
    vi.stubGlobal("fetch", makeFetch({ MediaContainer: { size: 0 } }));

    const result = await fetchPlexSessions({ ...baseConfig, fields: [...baseConfig.fields] });
    expect(result.streams).toBe(0);
    expect(result.transcodes).toBe(0);
    expect(result.lan_streams).toBe(0);
    expect(result.remote_streams).toBe(0);
    expect(result.users).toBe(0);
    expect(result.bandwidth).toBe(0);
  });

  it("only returns requested fields", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch({
        MediaContainer: {
          size: 1,
          Metadata: [{ TranscodeSession: {}, Session: { location: "lan", bandwidth: 500 }, User: { title: "Alice" } }],
        },
      })
    );

    const result = await fetchPlexSessions({ ...baseConfig, fields: ["streams", "transcodes"] });
    expect(result.streams).toBe(1);
    expect(result.transcodes).toBe(1);
    expect(result.lan_streams).toBeUndefined();
    expect(result.users).toBeUndefined();
  });

  it("throws with HTTP status when response is not ok", async () => {
    vi.stubGlobal("fetch", makeFetch(null, false, 401));

    await expect(
      fetchPlexSessions({ ...baseConfig, fields: ["streams"] })
    ).rejects.toThrow("401");
  });

  it("forwards the AbortSignal to fetch", async () => {
    const mockFetch = makeFetch({ MediaContainer: { size: 0 } });
    vi.stubGlobal("fetch", mockFetch);

    const controller = new AbortController();
    await fetchPlexSessions({ ...baseConfig, fields: ["streams"] }, controller.signal);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it("sends Accept: application/json header", async () => {
    const mockFetch = makeFetch({ MediaContainer: { size: 0 } });
    vi.stubGlobal("fetch", mockFetch);

    await fetchPlexSessions({ ...baseConfig, fields: ["streams"] });

    expect(mockFetch.mock.calls[0][1].headers).toMatchObject({
      Accept: "application/json",
    });
  });

  it("includes the token as a query parameter", async () => {
    const mockFetch = makeFetch({ MediaContainer: { size: 0 } });
    vi.stubGlobal("fetch", mockFetch);

    await fetchPlexSessions({ ...baseConfig, fields: ["streams"] });

    expect(mockFetch.mock.calls[0][0]).toContain("X-Plex-Token=mytoken");
  });
});

// ---------------------------------------------------------------------------
// fetchPlexLibraries
// ---------------------------------------------------------------------------

describe("fetchPlexLibraries", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  const baseConfig = {
    url: "http://plex.local:32400",
    token: "mytoken",
    fields: ["library_movies", "library_shows", "library_episodes", "library_music"] as const,
  };

  /** URL-based mock: avoids order-dependence from nested Promise.all */
  function makeSectionsMock(
    sections: Array<{ key: string; type: string }>,
    counts: Record<string, number>
  ) {
    return vi.fn().mockImplementation((url: string) => {
      // /library/sections (no /all) — return the section list
      if (!url.includes("/all")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ MediaContainer: { Directory: sections } }),
        });
      }
      // /library/sections/{key}/all — return totalSize from the counts map
      // Key in counts map: "{sectionKey}" or "{sectionKey}:type={n}"
      const keyMatch = url.match(/\/sections\/(\w+)\/all/);
      const sectionKey = keyMatch?.[1] ?? "";
      const typeMatch = url.match(/[?&]type=(\d+)/);
      const mapKey = typeMatch ? `${sectionKey}:type=${typeMatch[1]}` : sectionKey;
      const totalSize = counts[mapKey] ?? 0;
      return Promise.resolve({
        ok: true,
        json: async () => ({ MediaContainer: { totalSize } }),
      });
    });
  }

  it("returns correct counts across sections", async () => {
    vi.stubGlobal(
      "fetch",
      makeSectionsMock(
        [
          { key: "1", type: "movie" },
          { key: "2", type: "show" },
          { key: "3", type: "artist" },
        ],
        {
          "1": 150,           // movies
          "2": 40,            // shows (no type param)
          "2:type=4": 820,    // episodes
          "3:type=9": 200,    // albums
        }
      )
    );

    const result = await fetchPlexLibraries({ ...baseConfig, fields: [...baseConfig.fields] });
    expect(result.library_movies).toBe(150);
    expect(result.library_shows).toBe(40);
    expect(result.library_episodes).toBe(820);
    expect(result.library_music).toBe(200);
  });

  it("sums counts across multiple sections of the same type", async () => {
    vi.stubGlobal(
      "fetch",
      makeSectionsMock(
        [
          { key: "1", type: "movie" },
          { key: "2", type: "movie" },
        ],
        { "1": 100, "2": 50 }
      )
    );

    const result = await fetchPlexLibraries({ ...baseConfig, fields: ["library_movies"] });
    expect(result.library_movies).toBe(150);
  });

  it("uses /all endpoint with X-Plex-Container-Size=0 and totalSize", async () => {
    const mockFetch = makeSectionsMock([{ key: "1", type: "movie" }], { "1": 42 });
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchPlexLibraries({ ...baseConfig, fields: ["library_movies"] });
    expect(result.library_movies).toBe(42);

    const calls = mockFetch.mock.calls.map((c: unknown[]) => c[0] as string);
    const allCall = calls.find((u) => u.includes("/all"));
    expect(allCall).toContain("/sections/1/all");
    expect(allCall).toContain("X-Plex-Container-Size=0");
  });

  it("uses type=4 for episode count and type=9 for music albums", async () => {
    const mockFetch = makeSectionsMock(
      [{ key: "5", type: "show" }, { key: "6", type: "artist" }],
      { "5": 10, "5:type=4": 200, "6:type=9": 80 }
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchPlexLibraries({
      ...baseConfig,
      fields: ["library_episodes", "library_music"],
    });
    expect(result.library_episodes).toBe(200);
    expect(result.library_music).toBe(80);

    const calls = mockFetch.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(calls.some((u) => u.includes("type=4"))).toBe(true);
    expect(calls.some((u) => u.includes("type=9"))).toBe(true);
  });

  it("returns 0 when sections list is empty", async () => {
    vi.stubGlobal("fetch", makeFetch({ MediaContainer: { Directory: [] } }));

    const result = await fetchPlexLibraries({ ...baseConfig, fields: [...baseConfig.fields] });
    expect(result.library_movies).toBe(0);
    expect(result.library_shows).toBe(0);
    expect(result.library_episodes).toBe(0);
    expect(result.library_music).toBe(0);
  });

  it("throws with HTTP status when sections request is not ok", async () => {
    vi.stubGlobal("fetch", makeFetch(null, false, 403));

    await expect(
      fetchPlexLibraries({ ...baseConfig, fields: ["library_movies"] })
    ).rejects.toThrow("403");
  });

  it("skips a section if its /all request fails", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (!url.includes("/all")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            MediaContainer: {
              Directory: [
                { key: "1", type: "movie" },
                { key: "2", type: "movie" },
              ],
            },
          }),
        });
      }
      if (url.includes("/sections/1/all")) {
        return Promise.resolve({ ok: true, json: async () => ({ MediaContainer: { totalSize: 80 } }) });
      }
      // section 2: fails
      return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
    });

    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchPlexLibraries({ ...baseConfig, fields: ["library_movies"] });
    // Only first section counted
    expect(result.library_movies).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// Widget registration
// ---------------------------------------------------------------------------
// vi.resetModules() creates a fresh module graph per test, so we must
// dynamically re-import @/widgets AFTER importing the widget module to ensure
// getWidget() and registerWidget() share the same registry instance.

describe("plex widget registration", () => {
  beforeEach(() => {
    clearRegistry(); // clear the static-import registry
    vi.resetModules(); // reset module cache for fresh dynamic imports
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each([
    { columnSpan: 3, rowSpan: 2, count: 2, calls: 1 },
    { columnSpan: 6, rowSpan: 2, count: 3, calls: 1 },
    { columnSpan: 3, rowSpan: 4, count: 6, calls: 1 },
    { columnSpan: 6, rowSpan: 4, count: 10, calls: 2 },
  ])("fetches only the sources needed for automatic $columnSpan×$rowSpan fields", async ({ columnSpan, rowSpan, count, calls }) => {
    await import("@/integrations/plex/widget");
    const { getWidget } = await import("@/widgets");
    const widget = getWidget("plex")!;
    const fetchMock = makeFetch({ MediaContainer: { size: 0, Directory: [] } });
    vi.stubGlobal("fetch", fetchMock);
    const config = widget.configSchema.parse({ url: "http://plex.local:32400", token: "token", size_defaults: true });
    const data = await widget.fetchData(config, undefined, { footprint: { columnSpan, rowSpan } }) as PlexData;
    expect(Object.keys(data).filter(key => key !== "sessions")).toHaveLength(count);
    expect(data.sessions).toEqual(columnSpan === 3 && rowSpan === 4 ? [] : undefined);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/library/sections"))).toBe(calls === 2);
  });

  it("uses explicit library fields even on a compact automatic tile without requesting sessions", async () => {
    await import("@/integrations/plex/widget");
    const { getWidget } = await import("@/widgets");
    const widget = getWidget("plex")!;
    const fetchMock = makeFetch({ MediaContainer: { Directory: [] } });
    vi.stubGlobal("fetch", fetchMock);
    const config = widget.configSchema.parse({ url: "http://plex.local:32400", token: "token", size_defaults: true, fields: ["library_movies"] });
    expect(await widget.fetchData(config, undefined, { footprint: { columnSpan: 3, rowSpan: 2 } })).toEqual({ library_movies: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/library/sections");
  });

  it("registers a widget with id 'plex' on import", async () => {
    await import("@/integrations/plex/widget");
    const { getWidget: gw } = await import("@/widgets");
    expect(gw("plex")).toBeDefined();
  });

  it("widget name is 'Plex'", async () => {
    await import("@/integrations/plex/widget");
    const { getWidget: gw } = await import("@/widgets");
    expect(gw("plex")?.name).toBe("Plex");
  });

  it("configSchema accepts valid config with explicit fields", async () => {
    await import("@/integrations/plex/widget");
    const { getWidget: gw } = await import("@/widgets");
    const result = gw("plex")!.configSchema.safeParse({
      url: "http://192.168.1.10:32400",
      token: "abc123",
      fields: ["streams", "transcodes"],
    });
    expect(result.success).toBe(true);
  });

  it("configSchema uses default fields when fields is omitted", async () => {
    await import("@/integrations/plex/widget");
    const { getWidget: gw } = await import("@/widgets");
    const result = gw("plex")!.configSchema.safeParse({
      url: "http://192.168.1.10:32400",
      token: "abc123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fields).toEqual(["streams", "transcodes"]);
    }
  });

  it("configSchema rejects invalid URL", async () => {
    await import("@/integrations/plex/widget");
    const { getWidget: gw } = await import("@/widgets");
    const result = gw("plex")!.configSchema.safeParse({
      url: "not-a-url",
      token: "abc123",
      fields: ["streams"],
    });
    expect(result.success).toBe(false);
  });

  it("configSchema rejects empty token", async () => {
    await import("@/integrations/plex/widget");
    const { getWidget: gw } = await import("@/widgets");
    const result = gw("plex")!.configSchema.safeParse({
      url: "http://192.168.1.10:32400",
      token: "",
      fields: ["streams"],
    });
    expect(result.success).toBe(false);
  });

  it("configSchema rejects empty fields array", async () => {
    await import("@/integrations/plex/widget");
    const { getWidget: gw } = await import("@/widgets");
    const result = gw("plex")!.configSchema.safeParse({
      url: "http://192.168.1.10:32400",
      token: "abc",
      fields: [],
    });
    expect(result.success).toBe(false);
  });

  it("widget has configFields metadata", async () => {
    await import("@/integrations/plex/widget");
    const { getWidget: gw } = await import("@/widgets");
    const widget = gw("plex")!;
    expect(widget.configFields).toBeDefined();
    expect(widget.configFields?.length).toBeGreaterThan(0);
    const keys = widget.configFields?.map((f) => f.key);
    expect(keys).toContain("url");
    expect(keys).toContain("token");
    expect(keys).toContain("fields");
  });
});


describe("Plex playback projection", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const config = { url: "http://plex.local", token: "token", fields: ["streams"] as const };
  it("projects episode/movie playback fields from the same request without forwarding private metadata", async () => {
    const fetchMock = makeFetch({ MediaContainer: { size: 2, Metadata: [
      { type: "episode", title: "Delta-V", grandparentTitle: "The Expanse", parentIndex: 3, index: 5, duration: 100000, viewOffset: 43000,
        User: { title: "Alice", email: "private@example.test" }, Player: { state: "playing", address: "192.0.2.1", machineIdentifier: "private-id" },
        Session: { id: "private-session" }, TranscodeSession: { videoDecision: "transcode", key: "/private/path" }, Media: [{ Part: [{ file: "/private/movie.mkv" }] }] },
      { type: "movie", title: "Dune: Part Two", duration: "100000", viewOffset: "66000", User: { title: "Bob" }, Player: { state: "paused" } },
    ] } });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchPlexSessions({ ...config, fields: [...config.fields] }, undefined, true)).toEqual({ streams: 2, sessions: [
      { username: "Alice", title: "The Expanse · S03E05 · Delta-V", state: "playing", mediaType: "episode", transcodeDecision: "transcode", progressPercent: 43 },
      { username: "Bob", title: "Dune: Part Two", state: "paused", mediaType: "movie", transcodeDecision: "direct_play", progressPercent: 66 },
    ] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("handles absent metadata, unknown progress, audio titles and direct-stream decisions", async () => {
    vi.stubGlobal("fetch", makeFetch({ MediaContainer: { size: 3, Metadata: [
      {}, { type: "track", title: "Song", parentTitle: "Album", grandparentTitle: "Artist", duration: 0, viewOffset: 10, Media: [{ videoDecision: "copy" }] },
      { duration: 100, viewOffset: 130, TranscodeSession: { videoDecision: "copy" } },
    ] } }));
    const result = await fetchPlexSessions({ ...config, fields: [...config.fields] }, undefined, true);
    expect(result.sessions).toEqual([
      { username: "Unknown user", title: "Untitled", state: "unknown", mediaType: "unknown", transcodeDecision: "direct_play", progressPercent: null },
      { username: "Unknown user", title: "Artist · Album · Song", state: "unknown", mediaType: "track", transcodeDecision: "direct_stream", progressPercent: null },
      { username: "Unknown user", title: "Untitled", state: "unknown", mediaType: "unknown", transcodeDecision: "direct_stream", progressPercent: 100 },
    ]);
  });
  it.each([{ duration: 100, viewOffset: -1, expected: 0 }, { duration: 100, viewOffset: "invalid", expected: null }, { duration: -1, viewOffset: 10, expected: null }])("bounds progress or leaves it unknown (%j)", async ({ duration, viewOffset, expected }) => {
    vi.stubGlobal("fetch", makeFetch({ MediaContainer: { size: 1, Metadata: [{ duration, viewOffset }] } }));
    expect((await fetchPlexSessions({ ...config, fields: [...config.fields] }, undefined, true)).sessions![0].progressPercent).toBe(expected);
  });
  it("fetches playback even for a library-only Detailed selection, preserving exactly the chosen stats", async () => {
    await import("@/integrations/plex/widget"); const { getWidget } = await import("@/widgets"); const widget = getWidget("plex")!;
    const fetchMock = makeFetch({ MediaContainer: { size: 0, Directory: [] } }); vi.stubGlobal("fetch", fetchMock);
    const parsed = widget.configSchema.parse({ url: "http://plex", token: "token", fields: ["library_movies"] });
    expect(await widget.fetchData(parsed, undefined, { footprint: { columnSpan: 3, rowSpan: 4 } })).toEqual({ library_movies: 0, sessions: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
