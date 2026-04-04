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

  it("neutralises </style to prevent closing the style tag", () => {
    const r = resolveAppearance({
      ...base,
      appearance: { theme: "dark", custom_css: "body {} </style><script>bad</script>" },
    });
    expect(r.customCss).toBe("body {} <\\/style><script>bad</script>");
  });

  it("is case-insensitive when neutralising </style", () => {
    const r = resolveAppearance({
      ...base,
      appearance: { theme: "dark", custom_css: "a { } </STYLE><b>" },
    });
    expect(r.customCss).toBe("a { } <\\/STYLE><b>");
  });

  it("passes valid CSS through unchanged (child combinator, adjacent sibling)", () => {
    const css = "div > p { color: red; } h1 + h2 { margin: 0; }";
    const r = resolveAppearance({
      ...base,
      appearance: { theme: "dark", custom_css: css },
    });
    expect(r.customCss).toBe(css);
  });

  it("leaves other angle brackets intact", () => {
    const r = resolveAppearance({
      ...base,
      appearance: { theme: "dark", custom_css: ":root { --x: 1; } <img src=x onerror=alert(1)>" },
    });
    expect(r.customCss).toBe(":root { --x: 1; } <img src=x onerror=alert(1)>");
  });
});
