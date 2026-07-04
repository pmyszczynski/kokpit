import { describe, it, expect, beforeEach, vi } from "vitest";
import { fetchWithApiKey } from "@/integrations/shared/http";

function fakeResponse(overrides: Partial<Response> = {}): Response {
  return { ok: true, status: 200, ...overrides } as Response;
}

describe("fetchWithApiKey", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("resolves a relative path with no leading slash against a base URL with a trailing slash", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse());
    await fetchWithApiKey({ url: "http://host:1234/api/", api_key: "k" }, "v1/foo");
    const calledUrl = vi.mocked(fetch).mock.calls[0][0];
    expect(calledUrl).toBe("http://host:1234/api/v1/foo");
  });

  it("strips a leading slash so the sub-path in config.url is preserved", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse());
    await fetchWithApiKey({ url: "http://host:1234/api/", api_key: "k" }, "/v1/foo");
    const calledUrl = vi.mocked(fetch).mock.calls[0][0];
    expect(calledUrl).toBe("http://host:1234/api/v1/foo");
  });

  it("without a trailing slash on config.url, standard URL resolution drops the last base segment", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse());
    await fetchWithApiKey({ url: "http://host:1234/api", api_key: "k" }, "v1/foo");
    const calledUrl = vi.mocked(fetch).mock.calls[0][0];
    // This is inherent WHATWG URL resolution behavior (like a relative <a href>),
    // not something fetchWithApiKey special-cases.
    expect(calledUrl).toBe("http://host:1234/v1/foo");
  });

  it("resolves against a base URL with no sub-path", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse());
    await fetchWithApiKey({ url: "http://host:1234", api_key: "k" }, "/v1/foo");
    const calledUrl = vi.mocked(fetch).mock.calls[0][0];
    expect(calledUrl).toBe("http://host:1234/v1/foo");
  });

  it("passes an absolute http(s) URL through unchanged, ignoring config.url", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse());
    await fetchWithApiKey(
      { url: "http://host:1234/api/", api_key: "k" },
      "https://other-host.example.com/foo/bar"
    );
    const calledUrl = vi.mocked(fetch).mock.calls[0][0];
    expect(calledUrl).toBe("https://other-host.example.com/foo/bar");
  });

  it("sets the X-Api-Key header to config.api_key", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse());
    await fetchWithApiKey({ url: "http://host/", api_key: "super-secret" }, "ping");
    const options = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect((options.headers as Record<string, string>)["X-Api-Key"]).toBe("super-secret");
  });

  it("forwards the AbortSignal to fetch's options", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse());
    const controller = new AbortController();
    await fetchWithApiKey({ url: "http://host/", api_key: "k" }, "ping", controller.signal);
    const options = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(options.signal).toBe(controller.signal);
  });

  it("throws with the default 'Service' name on a non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse({ ok: false, status: 404 }));
    await expect(
      fetchWithApiKey({ url: "http://host/", api_key: "k" }, "ping")
    ).rejects.toThrow("Service responded with 404");
  });

  it("throws with a custom serviceName on a non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse({ ok: false, status: 500 }));
    await expect(
      fetchWithApiKey({ url: "http://host/", api_key: "k" }, "ping", undefined, "Radarr")
    ).rejects.toThrow("Radarr responded with 500");
  });

  it("returns the Response object unmodified on an ok response", async () => {
    const response = fakeResponse({ ok: true, status: 200 });
    vi.mocked(fetch).mockResolvedValue(response);
    const result = await fetchWithApiKey({ url: "http://host/", api_key: "k" }, "ping");
    expect(result).toBe(response);
  });
});
