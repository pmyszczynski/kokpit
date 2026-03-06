import { describe, it, expect } from "vitest";
import type { KokpitConfig } from "@/config";
import { resolveAppearance } from "@/config/theme";

const base: KokpitConfig = {
  schema_version: 1,
  auth: { enabled: false, session_ttl_hours: 24 },
  appearance: { theme: "dark" },
  layout: { columns: 4, row_height: 120 },
  services: [],
  widgets: [],
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

  it("strips </style> tags from customCss to prevent injection", () => {
    const r = resolveAppearance({
      ...base,
      appearance: { theme: "dark", custom_css: "body {} </style><script>bad</script>" },
    });
    expect(r.customCss).not.toContain("</style>");
  });
});
