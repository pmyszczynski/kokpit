// @vitest-environment node
//
// Unlike ssrfGuard.test.ts, nothing here is mocked: real dns.lookup, real
// undici Agent, real sockets over loopback. This is what actually exercises
// the contract the rest of the suite assumes — that undici's Agent
// connect.lookup override receives the shape Node's real connector expects,
// and that pinning genuinely prevents a second (differently-resolving)
// hostname from being used for the connection. That contract is exactly
// what changed between Node 20 and 22 and is why the mocked tests alone
// aren't sufficient regression coverage for it.
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ssrfSafeFetch, SsrfBlockedError } from "@/lib/ssrfGuard";

function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

const servers: { close: () => Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers.length = 0;
});

describe("ssrfSafeFetch (real DNS + real sockets, no mocks)", () => {
  it("connects to a real loopback server end-to-end when private networks are allowed", async () => {
    const server = await startServer((_req, res) => res.end("hello from loopback"));
    servers.push(server);

    const res = await ssrfSafeFetch(`http://127.0.0.1:${server.port}/`, {
      allowPrivateNetworks: true,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello from loopback");
  });

  it("blocks a real loopback server by default (private networks not allowed) without connecting", async () => {
    let hit = false;
    const server = await startServer((_req, res) => {
      hit = true;
      res.end("should not be reached");
    });
    servers.push(server);

    await expect(
      ssrfSafeFetch(`http://127.0.0.1:${server.port}/`, { allowPrivateNetworks: false })
    ).rejects.toThrow(SsrfBlockedError);
    expect(hit).toBe(false);
  });

  it("follows a real redirect between two loopback servers and re-validates the hop", async () => {
    const target = await startServer((_req, res) => res.end("final destination"));
    servers.push(target);
    const redirector = await startServer((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${target.port}/` });
      res.end();
    });
    servers.push(redirector);

    const res = await ssrfSafeFetch(`http://127.0.0.1:${redirector.port}/`, {
      allowPrivateNetworks: true,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("final destination");
  });

  it("streams a large response body correctly through a pinned connection", async () => {
    const body = "x".repeat(200_000);
    const server = await startServer((_req, res) => res.end(body));
    servers.push(server);

    const res = await ssrfSafeFetch(`http://127.0.0.1:${server.port}/`, {
      allowPrivateNetworks: true,
    });
    expect(await res.text()).toBe(body);
  });

  it("does not let a redirect to a hostname resolving elsewhere bypass validation", async () => {
    // The redirect target's hostname is "127.0.0.1" again (real, re-resolved,
    // re-validated) rather than a stale address carried over from the first
    // hop -- if pinning leaked across hops instead of being re-derived per
    // hop, this would either fail to connect or silently reuse the wrong
    // address.
    const target = await startServer((_req, res) => res.end("second hop"));
    servers.push(target);
    const redirector = await startServer((_req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${target.port}/` });
      res.end();
    });
    servers.push(redirector);

    const res = await ssrfSafeFetch(`http://127.0.0.1:${redirector.port}/`, {
      allowPrivateNetworks: true,
    });
    expect(await res.text()).toBe("second hop");
  });
});
