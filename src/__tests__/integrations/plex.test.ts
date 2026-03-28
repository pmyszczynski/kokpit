// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearRegistry, getWidget } from "@/widgets";
import { fetchPlexSessions, fetchPlexLibraries } from "@/integrations/plex/api";

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
  afterEach(() => vi.restoreAllMocks());

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
  afterEach(() => vi.restoreAllMocks());

  const baseConfig = {
    url: "http://plex.local:32400",
    token: "mytoken",
    fields: ["library_movies", "library_shows", "library_episodes", "library_music"] as const,
  };

  it("returns correct counts across sections", async () => {
    const mockFetch = vi.fn()
      // First call: /library/sections
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          MediaContainer: {
            Directory: [
              { key: "1", type: "movie" },
              { key: "2", type: "show" },
              { key: "3", type: "artist" },
            ],
          },
        }),
      })
      // Detail: section 1 (movies)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ MediaContainer: { size: 150, leafCount: 0 } }) })
      // Detail: section 2 (shows)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ MediaContainer: { size: 40, leafCount: 820 } }) })
      // Detail: section 3 (music)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ MediaContainer: { size: 200, leafCount: 0 } }) });

    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchPlexLibraries({ ...baseConfig, fields: [...baseConfig.fields] });
    expect(result.library_movies).toBe(150);
    expect(result.library_shows).toBe(40);
    expect(result.library_episodes).toBe(820);
    expect(result.library_music).toBe(200);
  });

  it("sums counts across multiple sections of the same type", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          MediaContainer: {
            Directory: [
              { key: "1", type: "movie" },
              { key: "2", type: "movie" },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ MediaContainer: { size: 100 } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ MediaContainer: { size: 50 } }) });

    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchPlexLibraries({ ...baseConfig, fields: ["library_movies"] });
    expect(result.library_movies).toBe(150);
  });

  it("returns 0 when sections list is empty", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch({ MediaContainer: { Directory: [] } })
    );

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

  it("skips a section if its detail request fails", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          MediaContainer: {
            Directory: [
              { key: "1", type: "movie" },
              { key: "2", type: "movie" },
            ],
          },
        }),
      })
      // First section: ok
      .mockResolvedValueOnce({ ok: true, json: async () => ({ MediaContainer: { size: 80 } }) })
      // Second section: fails
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

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
