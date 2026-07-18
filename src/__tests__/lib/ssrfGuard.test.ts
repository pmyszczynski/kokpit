// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const dnsLookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => dnsLookupMock(...args),
}));

const undiciFetchMock = vi.fn();
interface MockAgentOpts {
  connect: {
    lookup: (
      hostname: string,
      options: unknown,
      callback: (err: Error | null, addresses: { address: string; family: number }[]) => void
    ) => void;
  };
}
let createdAgents: { opts: MockAgentOpts }[] = [];
vi.mock("undici", () => ({
  fetch: (...args: unknown[]) => undiciFetchMock(...args),
  Agent: class {
    opts: MockAgentOpts;
    constructor(opts: MockAgentOpts) {
      this.opts = opts;
      createdAgents.push(this);
    }
    close() {
      return Promise.resolve();
    }
  },
}));

import { ssrfSafeFetch, SsrfBlockedError } from "@/lib/ssrfGuard";

function resolvesTo(ip: string, family: 4 | 6 = 4) {
  return [{ address: ip, family }];
}

function response(status: number, headers: Record<string, string> = {}) {
  return { ok: status >= 200 && status < 300, status, url: "", headers: new Headers(headers) };
}

beforeEach(() => {
  dnsLookupMock.mockReset();
  undiciFetchMock.mockReset();
  createdAgents = [];
});

describe("ssrfSafeFetch", () => {
  it("rejects a non-http(s) protocol before any DNS lookup", async () => {
    await expect(
      ssrfSafeFetch("ftp://example.com/file", { allowPrivateNetworks: false })
    ).rejects.toThrow(SsrfBlockedError);
    expect(dnsLookupMock).not.toHaveBeenCalled();
  });

  it("rejects an unparsable url", async () => {
    await expect(ssrfSafeFetch("not a url", { allowPrivateNetworks: false })).rejects.toThrow(
      SsrfBlockedError
    );
  });

  it.each([
    ["loopback", "127.0.0.1"],
    ["private (10.x)", "10.1.2.3"],
    ["private (192.168.x)", "192.168.1.1"],
    ["private (172.16-31.x)", "172.20.0.1"],
    ["link-local / cloud metadata", "169.254.169.254"],
    ["unique-local IPv6", "fd00:ec2::254"],
    ["loopback IPv6", "::1"],
  ])("blocks %s (%s) by default", async (_label, ip) => {
    dnsLookupMock.mockResolvedValue(resolvesTo(ip, ip.includes(":") ? 6 : 4));
    await expect(
      ssrfSafeFetch("http://target.example.com", { allowPrivateNetworks: false })
    ).rejects.toThrow(SsrfBlockedError);
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it("allows an ordinary public address by default", async () => {
    dnsLookupMock.mockResolvedValue(resolvesTo("93.184.216.34"));
    undiciFetchMock.mockResolvedValueOnce(response(200));
    const res = await ssrfSafeFetch("http://target.example.com", { allowPrivateNetworks: false });
    expect(res.status).toBe(200);
  });

  it.each(["10.1.2.3", "192.168.1.1", "172.20.0.1", "127.0.0.1"])(
    "allows %s when allowPrivateNetworks is true",
    async (ip) => {
      dnsLookupMock.mockResolvedValue(resolvesTo(ip));
      undiciFetchMock.mockResolvedValueOnce(response(200));
      const res = await ssrfSafeFetch("http://lan.example.com", { allowPrivateNetworks: true });
      expect(res.status).toBe(200);
    }
  );

  it("still blocks link-local/metadata even when allowPrivateNetworks is true", async () => {
    dnsLookupMock.mockResolvedValue(resolvesTo("169.254.169.254"));
    await expect(
      ssrfSafeFetch("http://target.example.com", { allowPrivateNetworks: true })
    ).rejects.toThrow(SsrfBlockedError);
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it("strips brackets from an IPv6 literal before resolving (dns.lookup rejects a bracketed literal)", async () => {
    dnsLookupMock.mockResolvedValue(resolvesTo("2606:4700:4700::1111", 6));
    undiciFetchMock.mockResolvedValueOnce(response(200));
    await ssrfSafeFetch("http://[2606:4700:4700::1111]:8080/", { allowPrivateNetworks: false });
    expect(dnsLookupMock).toHaveBeenCalledWith(
      "2606:4700:4700::1111",
      expect.anything()
    );
  });

  it("blocks when only one of several resolved addresses is disallowed", async () => {
    dnsLookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(
      ssrfSafeFetch("http://target.example.com", { allowPrivateNetworks: false })
    ).rejects.toThrow(SsrfBlockedError);
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it("blocks when DNS resolution throws", async () => {
    dnsLookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(
      ssrfSafeFetch("http://does-not-exist.example.com", { allowPrivateNetworks: false })
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("blocks when DNS resolves to nothing", async () => {
    dnsLookupMock.mockResolvedValue([]);
    await expect(
      ssrfSafeFetch("http://no-records.example.com", { allowPrivateNetworks: false })
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("re-validates a redirect target and rejects one pointing at a blocked address", async () => {
    dnsLookupMock.mockImplementation(async (hostname: string) =>
      hostname === "safe.example.com" ? resolvesTo("93.184.216.34") : resolvesTo("169.254.169.254")
    );
    undiciFetchMock.mockResolvedValueOnce(
      response(302, { location: "http://169.254.169.254/latest/meta-data/" })
    );
    await expect(
      ssrfSafeFetch("http://safe.example.com", { allowPrivateNetworks: false })
    ).rejects.toThrow(SsrfBlockedError);
    expect(undiciFetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect chain across allowed hosts and returns the final response", async () => {
    dnsLookupMock.mockResolvedValue(resolvesTo("93.184.216.34"));
    undiciFetchMock
      .mockResolvedValueOnce(response(301, { location: "https://hop2.example.com/" }))
      .mockResolvedValueOnce(response(302, { location: "https://hop3.example.com/" }))
      .mockResolvedValueOnce(response(200));
    const res = await ssrfSafeFetch("https://hop1.example.com", { allowPrivateNetworks: false });
    expect(res.status).toBe(200);
    expect(undiciFetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after too many redirect hops", async () => {
    dnsLookupMock.mockResolvedValue(resolvesTo("93.184.216.34"));
    undiciFetchMock.mockImplementation(async () =>
      response(302, { location: "https://next.example.com/" })
    );
    await expect(
      ssrfSafeFetch("https://start.example.com", { allowPrivateNetworks: false })
    ).rejects.toThrow(SsrfBlockedError);
  });

  it("pins the dispatcher's lookup to the addresses that were already validated", async () => {
    dnsLookupMock.mockResolvedValue(resolvesTo("93.184.216.34"));
    undiciFetchMock.mockResolvedValueOnce(response(200));
    await ssrfSafeFetch("http://target.example.com", { allowPrivateNetworks: false });
    const [, options] = undiciFetchMock.mock.calls[0];
    expect(options.dispatcher).toBeDefined();
    expect(options.redirect).toBe("manual");

    // Not enough to know a dispatcher was passed — assert its connect.lookup
    // actually returns the exact validated address, not a live re-resolution
    // of the hostname. This is the specific behavior DNS-rebinding
    // protection depends on.
    expect(createdAgents).toHaveLength(1);
    const lookup = createdAgents[0].opts.connect.lookup;
    const callback = vi.fn();
    lookup("target.example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
  });

  it("pins each redirect hop's dispatcher to that hop's own validated address, not the previous hop's", async () => {
    dnsLookupMock.mockImplementation(async (hostname: string) =>
      hostname === "hop1.example.com"
        ? resolvesTo("93.184.216.34")
        : resolvesTo("8.8.8.8")
    );
    undiciFetchMock
      .mockResolvedValueOnce(response(302, { location: "https://hop2.example.com/" }))
      .mockResolvedValueOnce(response(200));

    await ssrfSafeFetch("https://hop1.example.com", { allowPrivateNetworks: false });

    expect(createdAgents).toHaveLength(2);
    const firstLookup = createdAgents[0].opts.connect.lookup;
    const secondLookup = createdAgents[1].opts.connect.lookup;
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    firstLookup("hop1.example.com", {}, firstCallback);
    secondLookup("hop2.example.com", {}, secondCallback);
    expect(firstCallback).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
    expect(secondCallback).toHaveBeenCalledWith(null, [{ address: "8.8.8.8", family: 4 }]);
  });
});
