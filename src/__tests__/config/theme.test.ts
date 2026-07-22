import { describe, it, expect } from "vitest";
import type { KokpitConfig } from "@/config";
import { resolveAppearance, resolveBackgroundVars } from "@/config/theme";

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

  it("emits an empty bgStyle by default (no background layer, opaque cards)", () => {
    const r = resolveAppearance(base);
    expect(r.bgStyle).toEqual({});
  });
});

describe("resolveBackgroundVars", () => {
  it("returns no vars when nothing is configured", () => {
    expect(resolveBackgroundVars(undefined, undefined)).toEqual({});
    expect(resolveBackgroundVars({}, undefined)).toEqual({});
    expect(resolveBackgroundVars({}, 0)).toEqual({});
  });

  it("emits a color paint layer", () => {
    const v = resolveBackgroundVars({ color: "#0b0d12" }, undefined);
    expect(v["--app-bg-color"]).toBe("#0b0d12");
    expect(v["--app-bg-display"]).toBe("block");
    expect(v["--app-bg-image"]).toBeUndefined();
  });

  it("emits a gradient as a background-image value", () => {
    const v = resolveBackgroundVars(
      { gradient: "linear-gradient(135deg, #1e3a8a, #0f172a)" },
      undefined
    );
    expect(v["--app-bg-image"]).toBe("linear-gradient(135deg, #1e3a8a, #0f172a)");
    expect(v["--app-bg-display"]).toBe("block");
  });

  it("emits an image wrapped in a quoted url()", () => {
    const v = resolveBackgroundVars({ image: "/api/backgrounds/user/x.jpg" }, undefined);
    expect(v["--app-bg-image"]).toBe('url("/api/backgrounds/user/x.jpg")');
    expect(v["--app-bg-display"]).toBe("block");
  });

  it("is last-wins: image beats gradient beats color", () => {
    const v = resolveBackgroundVars(
      { color: "#000", gradient: "linear-gradient(#111,#222)", image: "/bg.png" },
      undefined
    );
    expect(v["--app-bg-image"]).toBe('url("/bg.png")');
    expect(v["--app-bg-color"]).toBeUndefined();

    const g = resolveBackgroundVars(
      { color: "#000", gradient: "linear-gradient(#111,#222)" },
      undefined
    );
    expect(g["--app-bg-image"]).toBe("linear-gradient(#111,#222)");
    expect(g["--app-bg-color"]).toBeUndefined();
  });

  it("emits blur and brightness filters", () => {
    const v = resolveBackgroundVars(
      { image: "/bg.png", blur: 12, brightness: 0.7 },
      undefined
    );
    expect(v["--app-bg-blur"]).toBe("12px");
    expect(v["--app-bg-brightness"]).toBe("0.7");
  });

  it("emits the overlay only when opacity > 0", () => {
    const on = resolveBackgroundVars({ color: "#000", opacity: 0.4 }, undefined);
    expect(on["--app-bg-overlay-opacity"]).toBe("0.4");
    expect(on["--app-bg-overlay-display"]).toBe("block");

    const off = resolveBackgroundVars({ color: "#000", opacity: 0 }, undefined);
    expect(off["--app-bg-overlay-display"]).toBeUndefined();
  });

  it("enables frosted glass only when card_blur > 0", () => {
    const off = resolveBackgroundVars(undefined, 0);
    expect(off["--card-backdrop"]).toBeUndefined();
    expect(off["--card-surface"]).toBeUndefined();

    const on = resolveBackgroundVars(undefined, 8);
    expect(on["--card-blur"]).toBe("8px");
    expect(on["--card-backdrop"]).toBe("blur(var(--card-blur))");
    expect(on["--card-surface"]).toBe("var(--color-surface-translucent)");
    expect(on["--card-surface-hover"]).toBe("var(--color-surface-2-translucent)");
  });

  it("strips characters that could break out of the inline style declaration", () => {
    const v = resolveBackgroundVars(
      { color: "red; background: url(evil)" },
      undefined
    );
    expect(v["--app-bg-color"]).toBe("red background: url(evil)");
  });

  it("escapes quotes and backslashes in an image url()", () => {
    const v = resolveBackgroundVars({ image: '/x").png' }, undefined);
    expect(v["--app-bg-image"]).toBe('url("/x\\").png")');
  });
});
