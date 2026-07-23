import { describe, it, expect } from "vitest";
import { resolveIconRef } from "@/config/iconRef";

describe("resolveIconRef", () => {
  it("expands a sh- shorthand to the selfh.st CDN svg path", () => {
    expect(resolveIconRef("sh-sonarr")).toEqual({
      kind: "shorthand",
      url: "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/sonarr.svg",
    });
  });

  it("expands a di- shorthand to the dashboard-icons CDN svg path", () => {
    expect(resolveIconRef("di-jellyfin")).toEqual({
      kind: "shorthand",
      url: "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/jellyfin.svg",
    });
  });

  it("expands an mdi- shorthand to the Material Design Icons CDN path", () => {
    expect(resolveIconRef("mdi-home-assistant")).toEqual({
      kind: "shorthand",
      url: "https://cdn.jsdelivr.net/npm/@mdi/svg/svg/home-assistant.svg",
    });
  });

  it("keeps only the first dash as the prefix separator (multi-segment slugs)", () => {
    expect(resolveIconRef("di-nginx-proxy-manager").url).toBe(
      "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/nginx-proxy-manager.svg"
    );
  });

  it("passes an http(s) URL through unchanged", () => {
    const url = "https://example.com/foo.png";
    expect(resolveIconRef(url)).toEqual({ kind: "url", url });
  });

  it("passes an absolute path (uploaded icon) through unchanged", () => {
    const path = "/api/icons/user/abc123.svg";
    expect(resolveIconRef(path)).toEqual({ kind: "url", url: path });
  });

  it("passes an unknown prefix through unchanged", () => {
    expect(resolveIconRef("zz-whatever")).toEqual({
      kind: "url",
      url: "zz-whatever",
    });
  });

  it("passes an empty string through unchanged", () => {
    expect(resolveIconRef("")).toEqual({ kind: "url", url: "" });
  });

  it("does not treat a URL that merely contains a known prefix as a shorthand", () => {
    const url = "https://cdn.example.com/di-thing.png";
    expect(resolveIconRef(url)).toEqual({ kind: "url", url });
  });

  it("refuses a shorthand whose slug is not a plain icon name (no path traversal)", () => {
    // A slug with slashes/dots would be a passthrough, not an expanded CDN
    // path — the resolver never lets a shorthand smuggle a traversal segment.
    expect(resolveIconRef("di-../../etc/passwd")).toEqual({
      kind: "url",
      url: "di-../../etc/passwd",
    });
  });

  it("returns the original (untrimmed) string on passthrough", () => {
    const raw = "  https://example.com/foo.png  ";
    expect(resolveIconRef(raw).url).toBe(raw);
  });

  it("does not crash on a prototype-polluting prefix (__proto__)", () => {
    const raw = "__proto__-x";
    expect(resolveIconRef(raw)).toEqual({ kind: "url", url: raw });
  });

  it("does not crash on a prototype-polluting prefix (constructor)", () => {
    const raw = "constructor-x";
    expect(resolveIconRef(raw)).toEqual({ kind: "url", url: raw });
  });

  it("does not crash on a prototype-polluting prefix (hasOwnProperty)", () => {
    const raw = "hasOwnProperty-x";
    expect(resolveIconRef(raw)).toEqual({ kind: "url", url: raw });
  });
});
