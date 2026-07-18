// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const dnsLookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => dnsLookupMock(...args),
}));

const undiciFetchMock = vi.fn();
vi.mock("undici", () => ({
  fetch: (...args: unknown[]) => undiciFetchMock(...args),
  // Real behavior isn't needed here — undiciFetchMock stands in for the
  // network call entirely, so the Agent this constructs is never used to
  // actually open a socket in these unit tests.
  Agent: class {
    constructor(_opts: unknown) {}
  },
}));

import { detectServiceIcon } from "@/lib/iconDetect";

const PUBLIC_IP = "93.184.216.34"; // example.com's real public address
const LAN_IP = "192.168.1.50";
const LOOPBACK_IP = "127.0.0.1";
const METADATA_IP = "169.254.169.254";

function htmlResponse(html: string, url = "http://example.com/", status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers({ "content-type": "text/html" }),
    body: {
      getReader: () => {
        let done = false;
        return {
          read: async () => {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: new TextEncoder().encode(html) };
          },
          cancel: async () => {},
        };
      },
    },
  };
}

function plainResponse(status: number, headers: Record<string, string> = {}) {
  return { ok: status >= 200 && status < 300, status, url: "", headers: new Headers(headers), body: undefined };
}

function resolvesTo(ip: string, family: 4 | 6 = 4) {
  return [{ address: ip, family }];
}

beforeEach(() => {
  dnsLookupMock.mockReset();
  undiciFetchMock.mockReset();
  // Default: every hostname resolves to an ordinary public address, so
  // tests that don't care about DNS/blocking behavior don't need to set it
  // up themselves.
  dnsLookupMock.mockResolvedValue(resolvesTo(PUBLIC_IP));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("detectServiceIcon", () => {
  it("returns null for a non-http(s) url", async () => {
    const result = await detectServiceIcon("ftp://example.com/file");
    expect(result).toEqual({ icon: null, source: null });
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it("returns null for an unparsable url", async () => {
    const result = await detectServiceIcon("not a url");
    expect(result).toEqual({ icon: null, source: null });
  });

  it("prefers an SVG icon over larger raster icons", async () => {
    undiciFetchMock.mockResolvedValueOnce(
      htmlResponse(
        `<html><head>
          <link rel="icon" sizes="192x192" href="/icon-192.png">
          <link rel="icon" type="image/svg+xml" href="/icon.svg">
        </head></html>`
      )
    );
    const result = await detectServiceIcon("http://example.com");
    expect(result).toEqual({ icon: "http://example.com/icon.svg", source: "page" });
  });

  it("picks the largest declared raster size over a smaller one", async () => {
    undiciFetchMock.mockResolvedValueOnce(
      htmlResponse(
        `<html><head>
          <link rel="icon" sizes="16x16" href="/favicon-16.png">
          <link rel="icon" sizes="192x192" href="/favicon-192.png">
        </head></html>`
      )
    );
    const result = await detectServiceIcon("http://example.com");
    expect(result).toEqual({ icon: "http://example.com/favicon-192.png", source: "page" });
  });

  it("prefers apple-touch-icon over a sizeless plain icon", async () => {
    undiciFetchMock.mockResolvedValueOnce(
      htmlResponse(
        `<html><head>
          <link rel="icon" href="/favicon.ico">
          <link rel="apple-touch-icon" href="/apple-touch-icon.png">
        </head></html>`
      )
    );
    const result = await detectServiceIcon("http://example.com");
    expect(result).toEqual({
      icon: "http://example.com/apple-touch-icon.png",
      source: "page",
    });
  });

  it("resolves a relative href against the response's final URL", async () => {
    undiciFetchMock.mockResolvedValueOnce(
      htmlResponse(
        '<html><head><link rel="icon" href="assets/icon.png"></head></html>',
        "http://example.com/app/"
      )
    );
    const result = await detectServiceIcon("http://example.com/app");
    expect(result).toEqual({
      icon: "http://example.com/app/assets/icon.png",
      source: "page",
    });
  });

  it("falls back to /favicon.ico when the page has no icon links", async () => {
    undiciFetchMock
      .mockResolvedValueOnce(htmlResponse("<html><head></head></html>"))
      .mockResolvedValueOnce(plainResponse(200, { "content-type": "image/x-icon" }));
    const result = await detectServiceIcon("http://example.com");
    expect(result).toEqual({ icon: "http://example.com/favicon.ico", source: "favicon" });
  });

  it("falls back to GET when /favicon.ico rejects HEAD with 405", async () => {
    undiciFetchMock
      .mockResolvedValueOnce(htmlResponse("<html><head></head></html>"))
      .mockResolvedValueOnce(plainResponse(405))
      .mockResolvedValueOnce(plainResponse(200, { "content-type": "image/x-icon" }));
    const result = await detectServiceIcon("http://example.com");
    expect(result).toEqual({ icon: "http://example.com/favicon.ico", source: "favicon" });
  });

  it("does not accept a favicon.ico response with a non-image content-type", async () => {
    undiciFetchMock
      .mockResolvedValueOnce(htmlResponse("<html><head></head></html>"))
      .mockResolvedValueOnce(plainResponse(200, { "content-type": "text/html" }))
      .mockResolvedValueOnce(plainResponse(404));
    const result = await detectServiceIcon("http://example.com");
    expect(result).toEqual({ icon: null, source: null });
  });

  it("falls back to a Simple Icons slug guess when nothing else matches", async () => {
    undiciFetchMock
      .mockResolvedValueOnce(htmlResponse("<html><head></head></html>"))
      .mockResolvedValueOnce(plainResponse(404))
      .mockResolvedValueOnce(plainResponse(200));
    const result = await detectServiceIcon("http://app.plex.tv");
    expect(result).toEqual({
      icon: "https://cdn.simpleicons.org/plex",
      source: "simple-icons",
    });
  });

  it("returns null when every strategy fails", async () => {
    undiciFetchMock.mockRejectedValue(new Error("network down"));
    const result = await detectServiceIcon("http://example.com");
    expect(result).toEqual({ icon: null, source: null });
  });
});

describe("detectServiceIcon - SSRF protection", () => {
  it("blocks a LAN target by default (private networks not allowed)", async () => {
    dnsLookupMock.mockResolvedValue(resolvesTo(LAN_IP));
    const result = await detectServiceIcon("http://printer.local");
    expect(result).toEqual({ icon: null, source: null });
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it("blocks loopback by default", async () => {
    dnsLookupMock.mockResolvedValue(resolvesTo(LOOPBACK_IP));
    const result = await detectServiceIcon("http://localhost:8080");
    expect(result).toEqual({ icon: null, source: null });
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it("allows a LAN target once KOKPIT_ICON_DETECT_ALLOW_PRIVATE_NETWORKS=true", async () => {
    vi.stubEnv("KOKPIT_ICON_DETECT_ALLOW_PRIVATE_NETWORKS", "true");
    dnsLookupMock.mockResolvedValue(resolvesTo(LAN_IP));
    undiciFetchMock.mockResolvedValueOnce(
      htmlResponse('<html><head><link rel="icon" href="/icon.png"></head></html>', "http://192.168.1.50/")
    );
    const result = await detectServiceIcon("http://192.168.1.50");
    expect(result.icon).toBe("http://192.168.1.50/icon.png");
  });

  it("still blocks cloud metadata even when private networks are allowed", async () => {
    vi.stubEnv("KOKPIT_ICON_DETECT_ALLOW_PRIVATE_NETWORKS", "true");
    dnsLookupMock.mockResolvedValue(resolvesTo(METADATA_IP));
    const result = await detectServiceIcon("http://sneaky.example.com");
    expect(result).toEqual({ icon: null, source: null });
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it("blocks a hostname that resolves to metadata via DNS (rebinding-style bypass)", async () => {
    // The hostname string itself doesn't look suspicious -- only the DNS
    // answer reveals it points at the metadata address. A check limited to
    // the literal hostname string would miss this.
    dnsLookupMock.mockResolvedValue(resolvesTo(METADATA_IP));
    const result = await detectServiceIcon("http://looks-fine.example.com");
    expect(result).toEqual({ icon: null, source: null });
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it("blocks when only some of a hostname's resolved addresses are private", async () => {
    dnsLookupMock.mockResolvedValue([
      { address: PUBLIC_IP, family: 4 },
      { address: LOOPBACK_IP, family: 4 },
    ]);
    const result = await detectServiceIcon("http://mixed.example.com");
    expect(result).toEqual({ icon: null, source: null });
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it("blocks when DNS resolution fails", async () => {
    dnsLookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    const result = await detectServiceIcon("http://does-not-exist.example.com");
    expect(result).toEqual({ icon: null, source: null });
    expect(undiciFetchMock).not.toHaveBeenCalled();
  });

  it("validates a redirect target and rejects one that points at a blocked address", async () => {
    // First hop resolves to a public IP and looks fine; the redirect it
    // returns points at the metadata address. A naive `redirect: "follow"`
    // fetch would transparently follow this.
    dnsLookupMock.mockImplementation(async (hostname: string) => {
      if (hostname === "evil-redirector.example.com") return resolvesTo(PUBLIC_IP);
      return resolvesTo(METADATA_IP);
    });
    undiciFetchMock
      .mockResolvedValueOnce(plainResponse(302, { location: "http://169.254.169.254/latest/meta-data/" }))
      // Page detection fails (blocked redirect); the favicon fallback then
      // tries the original, still-allowed host directly and also finds
      // nothing, so the overall result is a clean "not found", not a leak.
      .mockResolvedValueOnce(plainResponse(404));
    const result = await detectServiceIcon("http://evil-redirector.example.com");
    expect(result).toEqual({ icon: null, source: null });
    // The redirect target itself was never fetched -- rejected before a
    // second request to 169.254.169.254 was ever made.
    expect(undiciFetchMock).toHaveBeenCalledTimes(2);
    for (const call of undiciFetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("169.254.169.254");
    }
  });

  it("follows a redirect to another allowed public host", async () => {
    dnsLookupMock.mockResolvedValue(resolvesTo(PUBLIC_IP));
    undiciFetchMock
      .mockResolvedValueOnce(plainResponse(302, { location: "https://final.example.com/" }))
      .mockResolvedValueOnce(
        htmlResponse('<html><head><link rel="icon" href="/icon.png"></head></html>', "https://final.example.com/")
      );
    const result = await detectServiceIcon("http://redirector.example.com");
    expect(result).toEqual({ icon: "https://final.example.com/icon.png", source: "page" });
    expect(undiciFetchMock).toHaveBeenCalledTimes(2);
  });
});
