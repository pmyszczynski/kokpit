import { describe, expect, it } from "vitest";
import { isTrustedMutation } from "@/auth/requestGuard";

describe("isTrustedMutation", () => {
  it("requires Kokpit's explicit mutation header", () => {
    expect(isTrustedMutation(new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin" },
    }))).toBe(false);
  });

  it("accepts opted-in same-origin, browser-navigation, and non-browser requests", () => {
    expect(isTrustedMutation(new Request("http://localhost", {
      method: "POST",
      headers: { "x-kokpit-request": "1", "sec-fetch-site": "same-origin" },
    }))).toBe(true);
    expect(isTrustedMutation(new Request("http://localhost", {
      method: "POST",
      headers: { "x-kokpit-request": "1" },
    }))).toBe(true);
    expect(isTrustedMutation(new Request("http://localhost", {
      method: "POST",
      headers: { "x-kokpit-request": "1", "sec-fetch-site": "none" },
    }))).toBe(true);
  });

  it("rejects cross-site and same-site requests", () => {
    for (const fetchSite of ["cross-site", "same-site"]) {
      expect(isTrustedMutation(new Request("http://localhost", {
        method: "POST",
        headers: { "x-kokpit-request": "1", "sec-fetch-site": fetchSite },
      }))).toBe(false);
    }
  });
});
