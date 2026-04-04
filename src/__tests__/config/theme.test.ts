import { describe, it, expect } from "vitest";
import type { KokpitConfig } from "@/config";
import { resolveAppearance } from "@/config/theme";

const base: KokpitConfig = {
  schema_version: 1,
  auth: { enabled: false, session_ttl_hours: 24 },
  appearance: { theme: "dark" },
  layout: { columns: 4, row_height: 120 },
  services: [],
};

describe("resolveAppearance", () => {
  it("returns the theme from config", () => {
    const r = resolveAppearance({ ...base, appearance: { theme: "oled" } });
    expect(r.theme).toBe("oled");
  });

  it("returns undefined customCss when not set", () => {
    const r = resolveAppearance(base);
    expect(r.customCss).toBeUndefined();
  });

  it("returns customCss when set", () => {
    const r = resolveAppearance({
      ...base,
      appearance: { theme: "dark", custom_css: ":root { --color-accent: red; }" },
    });
    expect(r.customCss).toBe(":root { --color-accent: red; }");
  });

  it("HTML-escapes customCss to prevent injection", () => {
    const r = resolveAppearance({
      ...base,
      appearance: { theme: "dark", custom_css: "body {} </style><script>bad</script>" },
    });
    expect(r.customCss).toBe("body {} &lt;/style&gt;&lt;script&gt;bad&lt;/script&gt;");
  });

  it("HTML-escapes angle brackets in customCss", () => {
    const r = resolveAppearance({
      ...base,
      appearance: { theme: "dark", custom_css: ":root { --x: 1; } <img src=x onerror=alert(1)>" },
    });
    expect(r.customCss).toBe(":root { --x: 1; } &lt;img src=x onerror=alert(1)&gt;");
  });
});
