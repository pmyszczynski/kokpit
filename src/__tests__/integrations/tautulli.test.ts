// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchActivity,
  TautulliConfigSchema,
} from "@/integrations/tautulli/api";
import type { TautulliConfig } from "@/integrations/tautulli/api";

const BASE_CONFIG: TautulliConfig = {
  url: "http://tautulli.local:8181",
  api_key: "super-secret-key",
  sections: ["summary", "sessions"],
};

const ACTIVITY_RESPONSE = {
  response: {
    result: "success",
    message: null,
    data: {
      stream_count: "2",
      stream_count_direct_play: 1,
      stream_count_direct_stream: "0",
      stream_count_transcode: 1,
      total_bandwidth: "12500",
      sessions: [
        {
          username: "alice",
          user: "legacy-alice",
          friendly_name: "Alice Friendly",
          full_title: "The Expanse · S02E05",
          title: "Home",
          progress_percent: "42.8",
          state: "playing",
          media_type: "episode",
          transcode_decision: "transcode",
          email: "alice@example.test",
          ip_address: "203.0.113.5",
          machine_id: "private-machine",
          file: "/media/private/file.mkv",
          platform: "Private Device",
          thumb: "/library/metadata/1/thumb/1",
        },
      ],
    },
  },
};

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => body });
}

type TestActivityResponse = {
  response: { result: string; message: string | null; data: Record<string, unknown> };
};

function makeActivityResponse(): TestActivityResponse {
  return structuredClone(ACTIVITY_RESPONSE);
}

describe("fetchActivity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("maps the activity response to a privacy-minimized DTO", async () => {
    vi.stubGlobal("fetch", mockFetch(ACTIVITY_RESPONSE));

    const result = await fetchActivity(BASE_CONFIG);

    expect(result).toEqual({
      summary: {
        streamCount: 2,
        directPlayCount: 1,
        directStreamCount: 0,
        transcodeCount: 1,
        totalBandwidthKbps: 12500,
      },
      sessions: [{
        username: "alice",
        title: "The Expanse · S02E05",
        progressPercent: 42.8,
        state: "playing",
        mediaType: "episode",
        transcodeDecision: "transcode",
      }],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /alice@example|203\.0\.113\.5|private-machine|private\/file|Private Device|thumb/
    );
  });

  it("preserves a reverse-proxy HTTP root and sends documented query auth", async () => {
    const fetchMock = mockFetch(ACTIVITY_RESPONSE);
    vi.stubGlobal("fetch", fetchMock);

    await fetchActivity({ ...BASE_CONFIG, url: "http://tautulli.local/root/tautulli" });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/root/tautulli/api/v2");
    expect(url.searchParams.get("cmd")).toBe("get_activity");
    expect(url.searchParams.get("apikey")).toBe("super-secret-key");
  });

  it("forwards the AbortSignal", async () => {
    const fetchMock = mockFetch(ACTIVITY_RESPONSE);
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchActivity(BASE_CONFIG, controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), { signal: controller.signal });
  });

  it("returns only summary when sections is summary-only", async () => {
    vi.stubGlobal("fetch", mockFetch(ACTIVITY_RESPONSE));

    expect(await fetchActivity({ ...BASE_CONFIG, sections: ["summary"] })).toEqual({
      summary: {
        streamCount: 2,
        directPlayCount: 1,
        directStreamCount: 0,
        transcodeCount: 1,
        totalBandwidthKbps: 12500,
      },
    });
  });

  it("returns only sessions when sections is sessions-only", async () => {
    vi.stubGlobal("fetch", mockFetch(ACTIVITY_RESPONSE));

    expect(await fetchActivity({ ...BASE_CONFIG, sections: ["sessions"] })).toEqual({
      sessions: [{
        username: "alice", title: "The Expanse · S02E05", progressPercent: 42.8,
        state: "playing", mediaType: "episode", transcodeDecision: "transcode",
      }],
    });
  });

  it("uses username, user, friendly_name, and neutral fallbacks in that order", async () => {
    const response = makeActivityResponse();
    response.response.data.sessions = [
      { ...ACTIVITY_RESPONSE.response.data.sessions[0], username: "preferred" },
      { ...ACTIVITY_RESPONSE.response.data.sessions[0], username: " ", user: "legacy" },
      { ...ACTIVITY_RESPONSE.response.data.sessions[0], username: null, user: "", friendly_name: "friendly" },
      { ...ACTIVITY_RESPONSE.response.data.sessions[0], username: null, user: null, friendly_name: " " },
    ];
    vi.stubGlobal("fetch", mockFetch(response));

    expect((await fetchActivity(BASE_CONFIG)).sessions?.map(({ username }) => username)).toEqual([
      "preferred", "legacy", "friendly", "Unknown user",
    ]);
  });

  it("uses full_title, title, and a neutral fallback in that order", async () => {
    const response = makeActivityResponse();
    response.response.data.sessions = [
      { ...ACTIVITY_RESPONSE.response.data.sessions[0], full_title: "preferred" },
      { ...ACTIVITY_RESPONSE.response.data.sessions[0], full_title: " ", title: "title" },
      { ...ACTIVITY_RESPONSE.response.data.sessions[0], full_title: null, title: " " },
    ];
    vi.stubGlobal("fetch", mockFetch(response));

    expect((await fetchActivity(BASE_CONFIG)).sessions?.map(({ title }) => title)).toEqual([
      "preferred", "title", "Unknown title",
    ]);
  });

  it("clamps progress to zero through one hundred", async () => {
    const response = makeActivityResponse();
    response.response.data.sessions = [
      { ...ACTIVITY_RESPONSE.response.data.sessions[0], progress_percent: "-1" },
      { ...ACTIVITY_RESPONSE.response.data.sessions[0], progress_percent: 101 },
    ];
    vi.stubGlobal("fetch", mockFetch(response));

    expect((await fetchActivity(BASE_CONFIG)).sessions?.map(({ progressPercent }) => progressPercent)).toEqual([0, 100]);
  });

  it("normalizes missing or non-array sessions to an empty list", async () => {
    for (const sessions of [undefined, null, {}]) {
      const response = makeActivityResponse();
      if (sessions === undefined) delete response.response.data.sessions;
      else response.response.data.sessions = sessions;
      vi.stubGlobal("fetch", mockFetch(response));
      expect((await fetchActivity(BASE_CONFIG)).sessions).toEqual([]);
    }
  });

  it("normalizes absent or non-finite optional metrics to zero", async () => {
    const response = makeActivityResponse();
    delete response.response.data.stream_count;
    response.response.data.stream_count_direct_play = "not-a-number";
    response.response.data.stream_count_direct_stream = "Infinity";
    response.response.data.stream_count_transcode = Number.NaN;
    response.response.data.total_bandwidth = null;
    vi.stubGlobal("fetch", mockFetch(response));

    expect((await fetchActivity(BASE_CONFIG)).summary).toEqual({
      streamCount: 0, directPlayCount: 0, directStreamCount: 0, transcodeCount: 0, totalBandwidthKbps: 0,
    });
  });

  it("throws a status-only message for non-2xx responses", async () => {
    vi.stubGlobal("fetch", mockFetch({ response: { message: "leak" } }, false, 401));

    await expect(fetchActivity(BASE_CONFIG)).rejects.toThrow("Tautulli responded with 401");
  });

  it("rejects an error envelope and redacts the configured API key", async () => {
    vi.stubGlobal("fetch", mockFetch({ response: { result: "error", message: "Bad super-secret-key\nrequest", data: null } }));

    await expect(fetchActivity(BASE_CONFIG)).rejects.toThrow("Tautulli API error: Bad [redacted] request");
  });

  it("rejects invalid JSON with a Tautulli-specific message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError("bad JSON"); },
    }));

    await expect(fetchActivity(BASE_CONFIG)).rejects.toThrow("Tautulli returned invalid JSON");
  });

  it("rejects a malformed success envelope", async () => {
    vi.stubGlobal("fetch", mockFetch({ response: { result: "success", message: null } }));

    await expect(fetchActivity(BASE_CONFIG)).rejects.toThrow("Tautulli returned an invalid activity response");
  });
});

describe("TautulliConfigSchema", () => {
  it("defaults omitted sections to summary and sessions", () => {
    expect(TautulliConfigSchema.parse({ url: BASE_CONFIG.url, api_key: BASE_CONFIG.api_key }).sections).toEqual(["summary", "sessions"]);
  });

  it("rejects an empty sections array", () => {
    expect(() => TautulliConfigSchema.parse({ ...BASE_CONFIG, sections: [] })).toThrow();
  });

  it("rejects unknown section names", () => {
    expect(() => TautulliConfigSchema.parse({ ...BASE_CONFIG, sections: ["users"] })).toThrow();
  });
});
