// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearRegistry } from "@/widgets";
import { fetchTransferInfo, fetchTorrents, clearSidCache } from "@/integrations/qbittorrent/api";

const BASE_CONFIG = {
  url: "http://qbt.local:8080",
  username: "admin",
  password: "adminadmin",
};

const MOCK_TRANSFER_INFO = {
  dl_info_speed: 5_500_000,
  up_info_speed: 500_000,
  dl_info_data: 1_200_000_000,
  up_info_data: 345_000_000,
};

const MOCK_TORRENTS = [
  { name: "Ubuntu 24.04", progress: 0.74, dlspeed: 12_000_000, upspeed: 0 },
  { name: "Fedora 40", progress: 1.0, dlspeed: 0, upspeed: 1_000_000 },
];

function makeLoginResponse(sid: string) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "set-cookie" ? `SID=${sid}; Path=/` : null,
    },
  };
}

function makeJsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  };
}

function make403Response() {
  return { ok: false, status: 403, headers: { get: () => null } };
}

// ---------------------------------------------------------------------------
// fetchTransferInfo
// ---------------------------------------------------------------------------

describe("fetchTransferInfo", () => {
  beforeEach(() => clearSidCache());
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("logs in and returns transfer info", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(makeLoginResponse("sid123"))
        .mockResolvedValueOnce(makeJsonResponse(MOCK_TRANSFER_INFO))
    );
    const result = await fetchTransferInfo(BASE_CONFIG);
    expect(result).toEqual(MOCK_TRANSFER_INFO);
  });

  it("POSTs credentials as form-encoded body to /api/v2/auth/login", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeLoginResponse("sid"))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_TRANSFER_INFO));
    vi.stubGlobal("fetch", mockFetch);

    await fetchTransferInfo(BASE_CONFIG);

    const loginCall = mockFetch.mock.calls.find(([url]: [string]) =>
      url.includes("/auth/login")
    );
    expect(loginCall).toBeDefined();
    expect(loginCall[1].method).toBe("POST");
    expect(loginCall[1].body).toContain("username=admin");
    expect(loginCall[1].body).toContain("password=adminadmin");
  });

  it("attaches SID cookie to the data request", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeLoginResponse("mySession"))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_TRANSFER_INFO));
    vi.stubGlobal("fetch", mockFetch);

    await fetchTransferInfo(BASE_CONFIG);

    const dataCall = mockFetch.mock.calls.find(([url]: [string]) =>
      url.includes("/transfer/info")
    );
    expect(dataCall![1].headers.Cookie).toBe("SID=mySession");
  });

  it("caches SID and does not re-login on second call", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeLoginResponse("cachedSid"))
      .mockResolvedValue(makeJsonResponse(MOCK_TRANSFER_INFO));
    vi.stubGlobal("fetch", mockFetch);

    await fetchTransferInfo(BASE_CONFIG);
    await fetchTransferInfo(BASE_CONFIG);

    const loginCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      url.includes("/auth/login")
    );
    expect(loginCalls).toHaveLength(1);
  });

  it("re-logins on 403 and retries the request", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeLoginResponse("oldSid"))
      .mockResolvedValueOnce(make403Response())
      .mockResolvedValueOnce(makeLoginResponse("newSid"))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_TRANSFER_INFO));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchTransferInfo(BASE_CONFIG);
    expect(result).toEqual(MOCK_TRANSFER_INFO);

    const loginCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      url.includes("/auth/login")
    );
    expect(loginCalls).toHaveLength(2);
  });

  it("throws when login fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, headers: { get: () => null } })
    );
    await expect(fetchTransferInfo(BASE_CONFIG)).rejects.toThrow("401");
  });

  it("forwards the AbortSignal to the data request", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeLoginResponse("sid"))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_TRANSFER_INFO));
    vi.stubGlobal("fetch", mockFetch);

    const controller = new AbortController();
    await fetchTransferInfo(BASE_CONFIG, controller.signal);

    const dataCall = mockFetch.mock.calls.find(([url]: [string]) =>
      url.includes("/transfer/info")
    );
    expect(dataCall![1]).toMatchObject({ signal: controller.signal });
  });
});

// ---------------------------------------------------------------------------
// fetchTorrents
// ---------------------------------------------------------------------------

describe("fetchTorrents", () => {
  beforeEach(() => clearSidCache());
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("logs in and returns torrent list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(makeLoginResponse("sid123"))
        .mockResolvedValueOnce(makeJsonResponse(MOCK_TORRENTS))
    );
    const result = await fetchTorrents(BASE_CONFIG);
    expect(result).toEqual(MOCK_TORRENTS);
  });

  it("attaches SID cookie to the torrents request", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeLoginResponse("mySid"))
      .mockResolvedValueOnce(makeJsonResponse(MOCK_TORRENTS));
    vi.stubGlobal("fetch", mockFetch);

    await fetchTorrents(BASE_CONFIG);

    const dataCall = mockFetch.mock.calls.find(([url]: [string]) =>
      url.includes("/torrents/info")
    );
    expect(dataCall![1].headers.Cookie).toBe("SID=mySid");
  });

  it("throws when data request returns non-2xx after retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(makeLoginResponse("sid"))
        .mockResolvedValueOnce({ ok: false, status: 500, headers: { get: () => null } })
    );
    await expect(fetchTorrents(BASE_CONFIG)).rejects.toThrow("500");
  });
});

// ---------------------------------------------------------------------------
// Widget registration — qbittorrent-stats
// ---------------------------------------------------------------------------

// Enabled in Task 2 when statsWidget.tsx is implemented
describe("qbittorrent-stats widget registration", () => {
  beforeEach(() => {
    clearRegistry();
    vi.resetModules();
  });

  it("registers a widget with id 'qbittorrent-stats' on import", async () => {
    await import("@/integrations/qbittorrent/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("qbittorrent-stats")).toBeDefined();
  });

  it("widget name is 'qBittorrent Stats'", async () => {
    await import("@/integrations/qbittorrent/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("qbittorrent-stats")?.name).toBe("qBittorrent Stats");
  });

  it("refreshInterval is 10000", async () => {
    await import("@/integrations/qbittorrent/statsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("qbittorrent-stats")?.refreshInterval).toBe(10_000);
  });

  it("configSchema accepts valid config", async () => {
    await import("@/integrations/qbittorrent/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("qbittorrent-stats")!.configSchema.safeParse({
      url: "http://192.168.1.10:8080",
      username: "admin",
      password: "adminadmin",
    });
    expect(result.success).toBe(true);
  });

  it("configSchema rejects invalid URL", async () => {
    await import("@/integrations/qbittorrent/statsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("qbittorrent-stats")!.configSchema.safeParse({
      url: "not-a-url",
      username: "admin",
      password: "adminadmin",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Widget registration — qbittorrent-torrents
// ---------------------------------------------------------------------------

// Enabled in Task 3 when torrentsWidget.tsx is implemented
describe.skip("qbittorrent-torrents widget registration", () => {
  beforeEach(() => {
    clearRegistry();
    vi.resetModules();
  });

  it("registers a widget with id 'qbittorrent-torrents' on import", async () => {
    await import("@/integrations/qbittorrent/torrentsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("qbittorrent-torrents")).toBeDefined();
  });

  it("widget name is 'qBittorrent Torrents'", async () => {
    await import("@/integrations/qbittorrent/torrentsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("qbittorrent-torrents")?.name).toBe("qBittorrent Torrents");
  });

  it("refreshInterval is 30000", async () => {
    await import("@/integrations/qbittorrent/torrentsWidget");
    const { getWidget } = await import("@/widgets");
    expect(getWidget("qbittorrent-torrents")?.refreshInterval).toBe(30_000);
  });

  it("configSchema accepts valid config", async () => {
    await import("@/integrations/qbittorrent/torrentsWidget");
    const { getWidget } = await import("@/widgets");
    const result = getWidget("qbittorrent-torrents")!.configSchema.safeParse({
      url: "http://192.168.1.10:8080",
      username: "admin",
      password: "adminadmin",
    });
    expect(result.success).toBe(true);
  });
});
