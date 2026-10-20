// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchStats as fetchProwlarrStats } from "@/integrations/prowlarr/api";
import { fetchStats as fetchUnraidStats } from "@/integrations/unraid/api";
import { fetchTdarrStats } from "@/integrations/tdarr/api";
import { fetchAllMetrics, fetchChartHistory } from "@/integrations/netdata/api";
import { fetchAccounts } from "@/integrations/actualbudget/api";
import { CredentialRedirectError } from "@/integrations/shared/credentialFetch";

afterEach(() => vi.unstubAllGlobals());

describe("credential policies on integration transports", () => {
  it.each([
    ["Prowlarr", () => fetchProwlarrStats({ url: "http://service.local/proxy/", api_key: "secret" })],
    ["Netdata metrics", () => fetchAllMetrics({ url: "http://service.local/proxy/", api_token: "secret" })],
    ["Netdata history", () => fetchChartHistory({ url: "http://service.local/proxy/", api_token: "secret" }, "system.cpu")],
    ["Actual Budget", () => fetchAccounts({ url: "http://service.local/proxy/", api_key: "secret", budget_sync_id: "budget", encryption_password: "other-secret", currency: "USD", privacy_mode: false })],
  ])("blocks %s credential redirects to another origin", async (_name, run) => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(null, {
      status: 302, headers: { Location: "http://forbidden.local/stolen" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(run()).rejects.toBeInstanceOf(CredentialRedirectError);
    expect(fetchMock).toHaveBeenCalled();
    for (const [url, options] of fetchMock.mock.calls) {
      expect(new URL(url).origin).toBe("http://service.local");
      expect(options.redirect).toBe("manual");
    }
  });

  it.each([
    ["Unraid", () => fetchUnraidStats({ url: "http://service.local/proxy/", api_key: "secret" })],
    ["Tdarr", () => fetchTdarrStats({ url: "http://service.local/proxy/", apikey: "secret" })],
  ])("never replays %s POST requests even on the same origin", async (_name, run) => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      if (init.method === "POST") return new Response(null, { status: 307, headers: { Location: "/replayed" } });
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(run()).rejects.toBeInstanceOf(CredentialRedirectError);
    expect(fetchMock.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain("http://service.local/replayed");
  });

  it("keeps Tdarr's optional node failure optional while rejecting its redirect destination", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("cruddb")) return new Response('{"table1Count":7}');
      return new Response(null, { status: 302, headers: { Location: "http://forbidden.local/stolen" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchTdarrStats({ url: "http://service.local/", apikey: "secret" })).toMatchObject({ transcodeQueue: 7, activeWorkers: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls) expect(new URL(url).origin).toBe("http://service.local");
  });
});
