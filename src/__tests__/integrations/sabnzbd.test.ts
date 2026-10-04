// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearRegistry } from "@/widgets";
import { fetchQueueData } from "@/integrations/sabnzbd/api";

const BASE_CONFIG = {
  url: "http://sabnzbd.local:8080",
  apikey: "abc123def456",
};

// SABnzbd returns kbpersec and mb as numeric strings; noofslots is an integer.
const MOCK_QUEUE_RESPONSE = {
  queue: {
    kbpersec: "5120.00",
    mb: "4096.50",
    noofslots: 3,
  },
};

function makeJsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function makeErrorResponse(status: number) {
  return { ok: false, status };
}

// ---------------------------------------------------------------------------
// fetchQueueData
// ---------------------------------------------------------------------------

describe("fetchQueueData", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns correctly transformed data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse(MOCK_QUEUE_RESPONSE)));

    const result = await fetchQueueData(BASE_CONFIG);

    expect(result).toEqual({
      speedBytesPerSec: 5_120_000,
      totalMb: 4096.5,
      queueCount: 3,
      remainingMb: null, timeLeft: null, status: null,
    });
  });

  it("reads detailed metrics from the same queue response without extra requests", async () => {
    const fetch = vi.fn().mockResolvedValue(makeJsonResponse({ queue: {
      ...MOCK_QUEUE_RESPONSE.queue, mbleft: "1024.50", timeleft: "0:16:44", status: "Downloading",
    } }));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchQueueData(BASE_CONFIG)).toMatchObject({ remainingMb: 1024.5, timeLeft: "0:16:44", status: "Downloading" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([null, "", "not a number", -1, true])("keeps summary data when optional remaining size is invalid: %j", async (mbleft) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeJsonResponse({ queue: {
      ...MOCK_QUEUE_RESPONSE.queue, mbleft, timeleft: "", status: 42,
    } })));
    expect(await fetchQueueData(BASE_CONFIG)).toMatchObject({ speedBytesPerSec: 5_120_000, queueCount: 3, remainingMb: null, timeLeft: null, status: null });
  });

  it("builds the correct URL with required query params", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_QUEUE_RESPONSE));
    vi.stubGlobal("fetch", mockFetch);

    await fetchQueueData(BASE_CONFIG);

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    const parsed = new URL(calledUrl);
    expect(parsed.pathname).toBe("/api");
    expect(parsed.searchParams.get("output")).toBe("json");
    expect(parsed.searchParams.get("apikey")).toBe("abc123def456");
    expect(parsed.searchParams.get("mode")).toBe("queue");
  });

  it("throws when the response is non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeErrorResponse(403)));

    await expect(fetchQueueData(BASE_CONFIG)).rejects.toThrow("403");
  });

  it("throws when the response is 500", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeErrorResponse(500)));

    await expect(fetchQueueData(BASE_CONFIG)).rejects.toThrow("500");
  });

  it("forwards the AbortSignal to the request", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse(MOCK_QUEUE_RESPONSE));
    vi.stubGlobal("fetch", mockFetch);

    const controller = new AbortController();
    await fetchQueueData(BASE_CONFIG, controller.signal);

    expect(mockFetch.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });
});

// ---------------------------------------------------------------------------
// Widget registration
// ---------------------------------------------------------------------------

describe("sabnzbd widget registration", () => {
  beforeEach(() => {
    clearRegistry();
    vi.resetModules();
  });

  it("registers a widget with id 'sabnzbd' on import", async () => {
    await import("@/integrations/sabnzbd/widget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("sabnzbd")).toBeDefined();
  });

  it("uses shared feedback and keeps the wide footprint alongside the compact default", async () => {
    await import("@/integrations/sabnzbd/widget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("sabnzbd")).toMatchObject({
      preferredSize: "normal", compactHeader: true, sharedUI: true,
      supportedFootprints: [
        { label: "Compact", columnSpan: 3, rowSpan: 2 },
        { label: "Detailed", columnSpan: 3, rowSpan: 4 },
        { label: "Wide", columnSpan: 6, rowSpan: 2 },
      ],
    });
  });

  it("widget name is 'SABnzbd'", async () => {
    await import("@/integrations/sabnzbd/widget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("sabnzbd")?.name).toBe("SABnzbd");
  });

  it("refreshInterval is 10000", async () => {
    await import("@/integrations/sabnzbd/widget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("sabnzbd")?.refreshInterval).toBe(10_000);
  });

  it("configSchema accepts valid config", async () => {
    await import("@/integrations/sabnzbd/widget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("sabnzbd")!.configSchema.safeParse({
      url: "http://192.168.1.10:8080",
      apikey: "abc123",
    });
    expect(result.success).toBe(true);
  });

  it("configSchema rejects invalid URL", async () => {
    await import("@/integrations/sabnzbd/widget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("sabnzbd")!.configSchema.safeParse({
      url: "not-a-url",
      apikey: "abc123",
    });
    expect(result.success).toBe(false);
  });

  it("configSchema rejects missing apikey", async () => {
    await import("@/integrations/sabnzbd/widget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("sabnzbd")!.configSchema.safeParse({
      url: "http://192.168.1.10:8080",
    });
    expect(result.success).toBe(false);
  });

  it("configSchema rejects empty apikey", async () => {
    await import("@/integrations/sabnzbd/widget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("sabnzbd")!.configSchema.safeParse({
      url: "http://192.168.1.10:8080",
      apikey: "",
    });
    expect(result.success).toBe(false);
  });
});
