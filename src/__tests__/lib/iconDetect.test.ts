// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { detectServiceIcon } from "@/lib/iconDetect";

function htmlResponse(html: string, url = "http://example.com/") {
  return {
    ok: true,
    url,
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
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectServiceIcon", () => {
  it("returns null for a non-http(s) url", async () => {
    const result = await detectServiceIcon("ftp://example.com/file");
    expect(result).toEqual({ icon: null, source: null });
  });

  it("returns null for an unparsable url", async () => {
    const result = await detectServiceIcon("not a url");
    expect(result).toEqual({ icon: null, source: null });
  });

  it("prefers an SVG icon over larger raster icons", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        htmlResponse(
          `<html><head>
            <link rel="icon" sizes="192x192" href="/icon-192.png">
            <link rel="icon" type="image/svg+xml" href="/icon.svg">
          </head></html>`
        )
      )
    );
    const result = await detectServiceIcon("http://example.com");
    expect(result).toEqual({ icon: "http://example.com/icon.svg", source: "page" });
  });

  it("picks the largest declared raster size over a smaller one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        htmlResponse(
          `<html><head>
            <link rel="icon" sizes="16x16" href="/favicon-16.png">
            <link rel="icon" sizes="192x192" href="/favicon-192.png">
          </head></html>`
        )
      )
    );
    const result = await detectServiceIcon("http://example.com");
    expect(result).toEqual({ icon: "http://example.com/favicon-192.png", source: "page" });
  });

  it("prefers apple-touch-icon over a sizeless plain icon", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        htmlResponse(
          `<html><head>
            <link rel="icon" href="/favicon.ico">
            <link rel="apple-touch-icon" href="/apple-touch-icon.png">
          </head></html>`
        )
      )
    );
    const result = await detectServiceIcon("http://example.com");
    expect(result).toEqual({
      icon: "http://example.com/apple-touch-icon.png",
      source: "page",
    });
  });

  it("resolves a relative href against the response's final URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        htmlResponse(
          '<html><head><link rel="icon" href="assets/icon.png"></head></html>',
          "http://example.com/app/"
        )
      )
    );
    const result = await detectServiceIcon("http://example.com/app");
    expect(result).toEqual({
      icon: "http://example.com/app/assets/icon.png",
      source: "page",
    });
  });

  it("falls back to /favicon.ico when the page has no icon links", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse("<html><head></head></html>"))
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers({ "content-type": "image/x-icon" }),
      } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await detectServiceIcon("http://example.com");
    expect(result).toEqual({ icon: "http://example.com/favicon.ico", source: "favicon" });
  });

  it("does not accept a favicon.ico response with a non-image content-type", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse("<html><head></head></html>"))
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
      } as Response)
      .mockResolvedValueOnce({ status: 404 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await detectServiceIcon("http://example.com");
    expect(result).toEqual({ icon: null, source: null });
  });

  it("falls back to a Simple Icons slug guess when nothing else matches", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse("<html><head></head></html>"))
      .mockResolvedValueOnce({ status: 404 } as Response)
      .mockResolvedValueOnce({ status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await detectServiceIcon("http://app.plex.tv");
    expect(result).toEqual({
      icon: "https://cdn.simpleicons.org/plex",
      source: "simple-icons",
    });
  });

  it("returns null when every strategy fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await detectServiceIcon("http://example.com");
    expect(result).toEqual({ icon: null, source: null });
  });
});
