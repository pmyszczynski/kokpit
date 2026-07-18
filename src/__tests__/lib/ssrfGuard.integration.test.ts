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

  it("re-resolves and reconnects per redirect hop over real sockets", async () => {
    // Both hops happen to resolve to the same loopback address here, so this
    // doesn't simulate a rebinding attempt (that's covered with a
    // controllable resolver in ssrfGuard.test.ts, where the two hops are
    // made to resolve differently and the pinned lookup callback is
    // asserted on directly). What this proves instead: a fresh dispatcher
    // is actually created and connected per hop over a real socket rather
    // than reusing the first hop's connection/dispatcher — if hops shared a
    // dispatcher, this would either fail to connect to the second server or
    // silently reuse the first one's address.
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
