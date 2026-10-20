import { describe, expect, it } from "vitest";
import { parseHttpUrl } from "@/integrations/shared/httpUrl";
describe("shared absolute browser URL policy", () => {
  it.each(["https://example.com/path?language=en", "http://[::1]:8080/search"])("retains a valid HTTP(S) destination: %s", value => {
    expect(parseHttpUrl(value)?.href).toBe(value);
  });
  it.each(["javascript:alert(1)", "/relative", "https://user@example.com/", "https://user:password@example.com/"])("rejects non-HTTP or credentialed destinations: %s", value => {
    expect(parseHttpUrl(value)).toBeNull();
  });
  it.each(["#", "#details"])("allows event fragments and rejects collection/search fragments: %s", fragment => {
    const value = `https://example.com/path${fragment}`;
    expect(parseHttpUrl(value)?.href).toBe(value);
    expect(parseHttpUrl(value, { allowFragment: false })).toBeNull();
  });
  it("retains encoded fragment characters in a path or fixed query parameter", () => {
    expect(parseHttpUrl("https://example.com/%23path?category=%23home", { allowFragment: false })?.href).toBe("https://example.com/%23path?category=%23home");
  });
});
