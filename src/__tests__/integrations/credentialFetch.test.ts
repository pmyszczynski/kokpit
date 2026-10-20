// @vitest-environment node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { credentialFetch, CredentialRedirectError } from "@/integrations/shared/credentialFetch";
import { widgetFetchFailure } from "@/widgets/publicFetchError";

const servers: Server[] = [];
async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
});

describe("credentialFetch transport", () => {
  it("follows same-origin relative and absolute redirects, preserving headers but not appending query credentials", async () => {
    const seen: Array<{ url: string | undefined; headers: IncomingMessage['headers'] }> = [];
    const base = await listen((req, res) => {
      seen.push({ url: req.url, headers: req.headers });
      if (req.url?.startsWith("/proxy/start")) res.writeHead(302, { Location: "middle" }).end();
      else if (req.url === "/proxy/middle") res.writeHead(308, { Location: `${base}/proxy/final` }).end();
      else res.end("done");
    });
    const response = await credentialFetch(base, `${base}/proxy/start?apikey=query-secret`, {
      headers: { "X-Api-Key": "custom-secret", "X-Netdata-Auth": "netdata-secret", Authorization: "Bearer bearer-secret", Cookie: "SID=cookie-secret" },
    });
    expect(await response.text()).toBe("done");
    expect(seen.map(request => request.url)).toEqual(["/proxy/start?apikey=query-secret", "/proxy/middle", "/proxy/final"]);
    for (const request of seen) {
      expect(request.headers).toMatchObject({ "x-api-key": "custom-secret", "x-netdata-auth": "netdata-secret", authorization: "Bearer bearer-secret", cookie: "SID=cookie-secret" });
    }
  });

  it.each(["GET", "HEAD"])("never contacts a different port when a %s redirect copies query credentials", async method => {
    const forbidden = vi.fn((_req: IncomingMessage, res: ServerResponse) => res.end("leaked"));
    const other = await listen(forbidden);
    const base = await listen((_req, res) => res.writeHead(302, { Location: `${other}/stolen?apikey=query-secret` }).end());
    await expect(credentialFetch(base, `${base}/start?apikey=query-secret`, {
      method, headers: { "x-api-key": "header-secret", "X-Netdata-Auth": "token-secret", Cookie: "SID=cookie-secret", Authorization: "Bearer bearer-secret" },
    })).rejects.toBeInstanceOf(CredentialRedirectError);
    expect(forbidden).not.toHaveBeenCalled();
  });

  it.each([301, 302, 303, 307, 308])("does not replay a login form on a same-origin %i redirect", async status => {
    const received: string[] = [];
    const base = await listen((req, res) => {
      received.push(req.url!);
      req.resume();
      res.writeHead(status, { Location: "/replayed" }).end();
    });
    await expect(credentialFetch(base, `${base}/login`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "username=test&password=synthetic-secret",
    })).rejects.toBeInstanceOf(CredentialRedirectError);
    expect(received).toEqual(["/login"]);
  });

  it("rejects initial cross-origin targets before either server receives credentials", async () => {
    const baseRequests = vi.fn((_req: IncomingMessage, res: ServerResponse) => res.end());
    const otherRequests = vi.fn((_req: IncomingMessage, res: ServerResponse) => res.end());
    const base = await listen(baseRequests); const other = await listen(otherRequests);
    await expect(credentialFetch(base, `${other}/initial`, { headers: { "X-Api-Key": "secret" } })).rejects.toBeInstanceOf(CredentialRedirectError);
    expect(baseRequests).not.toHaveBeenCalled(); expect(otherRequests).not.toHaveBeenCalled();
  });

  it("uses the caller's abort for the whole redirect chain", async () => {
    let reached: (() => void) | undefined;
    const pending = new Promise<void>(resolve => { reached = resolve; });
    const base = await listen((req, res) => {
      if (req.url === "/start") res.writeHead(302, { Location: "/wait" }).end();
      else reached?.();
    });
    const controller = new AbortController();
    const request = credentialFetch(base, `${base}/start`, { signal: controller.signal });
    await pending; controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("credentialFetch validation and cleanup", () => {
  it.each([
    "http://other.example/path", "https://service.example/path", "http://service.example:8080/path",
    "//other.example/path", "http://user:password@service.example/path", "ftp://service.example/path", "data:text/plain,secret", "http://[invalid",
  ])("rejects forbidden redirect %s and cancels its body", async location => {
    const redirect = new Response("discarded", { status: 302, headers: { Location: location } });
    const cancel = vi.spyOn(redirect.body!, "cancel");
    const fetchMock = vi.fn().mockResolvedValue(redirect); vi.stubGlobal("fetch", fetchMock);
    await expect(credentialFetch("http://service.example", "http://service.example/start")).rejects.toBeInstanceOf(CredentialRedirectError);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(["http://name:secret@service.example", "ftp://service.example", "invalid"])("rejects an invalid configured base %s without fetching", async base => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(credentialFetch(base, "http://service.example/start")).rejects.toBeInstanceOf(CredentialRedirectError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts canonical default ports and preserves HEAD", async () => {
    const response = new Response(null);
    const fetchMock = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", fetchMock);
    expect(await credentialFetch("http://SERVICE.example:80", "http://service.example/final", { method: "HEAD" })).toBe(response);
    expect(fetchMock).toHaveBeenCalledWith("http://service.example/final", { method: "HEAD", redirect: "manual" });
  });

  it("follows five redirects and refuses the sixth without fetching it", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => new Response(null, {
      status: 302, headers: { Location: `/hop/${Number(new URL(url).pathname.split("/").pop()) + 1}` },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(credentialFetch("http://service.example", "http://service.example/hop/0")).rejects.toBeInstanceOf(CredentialRedirectError);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls.map(call => call[0])).not.toContain("http://service.example/hop/6");
  });

  it("returns a final response after exactly five redirects", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const hop = Number(new URL(url).pathname.split("/").pop());
      return hop === 5 ? new Response("done") : new Response(null, { status: 302, headers: { Location: `/hop/${hop + 1}` } });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await (await credentialFetch("http://service.example", "http://service.example/hop/0")).text()).toBe("done");
  });

  it("detects loops even when fragments differ", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "/start#different" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(credentialFetch("http://service.example", "http://service.example/start")).rejects.toBeInstanceOf(CredentialRedirectError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a redirect missing Location and cancels the discarded response", async () => {
    const redirect = new Response("discarded", { status: 302 });
    const cancel = vi.spyOn(redirect.body!, "cancel"); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(redirect));
    await expect(credentialFetch("http://service.example", "http://service.example/start")).rejects.toBeInstanceOf(CredentialRedirectError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not fetch an already aborted request", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController(); controller.abort();
    await expect(credentialFetch("http://service.example", "http://service.example/start", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exposes only controlled final-URL guidance in the public error and log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://secret-user:secret-password@other.example/?apikey=secret-key" } })));
    let error: unknown;
    try { await credentialFetch("http://service.example", "http://service.example/?apikey=source-secret"); } catch (caught) { error = caught; }
    const failure = widgetFetchFailure("load", "radarr-stats", error);
    expect(failure).toMatchObject({ status: 502, body: { code: "widget_upstream_redirect_blocked", retryable: false, error: expect.stringContaining("final URL") } });
    expect(JSON.stringify([failure, log.mock.calls])).not.toMatch(/secret-|other\.example|service\.example/);
  });
});
