import { afterEach, describe, expect, it } from "vitest";
import { applyAppearance } from "@/lib/clientAppearance";
import { resolveAppearance, resolveBackgroundVars } from "@/config/theme";
import type { KokpitConfig } from "@/config/schema";

const config: KokpitConfig = {
  schema_version: 2,
  auth: { enabled: false, session_ttl_hours: 24 },
  appearance: { theme: "dark" },
  layout: { columns: 4, row_height: 120 },
  services: [], service_tiles: [],
};

afterEach(() => {
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
  delete document.documentElement.dataset.theme;
});

describe("client appearance reconciliation", () => {
  it("updates the document from the same sanitized appearance used on the server", () => {
    const appearance = resolveAppearance({ ...config, appearance: {
      theme: "oled", custom_css: 'body > main { color: red; } </style><script>bad</script>',
      background: { image: '/x").png', blur: 3, brightness: 0.6, opacity: 0.2 }, card_blur: 8,
    } });
    applyAppearance(appearance);
    expect(document.documentElement).toHaveAttribute("data-theme", "oled");
    for (const [property, value] of Object.entries(appearance.bgStyle)) {
      expect(document.body.style.getPropertyValue(property)).toBe(value);
    }
    const style = document.getElementById("kokpit-custom-css");
    expect(style?.textContent).toBe(`@layer user-custom { ${appearance.customCss} }`);
    expect(document.querySelector("script")).toBeNull();
    expect(style?.querySelector("script")).toBeNull();
  });

  it("reuses the server style owner and replaces or clears its CSS without stacking", () => {
    const serverStyle = document.createElement("style");
    serverStyle.id = "kokpit-custom-css";
    serverStyle.textContent = "@layer user-custom { :root { --old: red; } }";
    document.body.append(serverStyle);
    const appearance = { theme: "light", customCss: ":root { --new: blue; }", bgStyle: {} };
    applyAppearance(appearance);
    applyAppearance(appearance);
    expect(document.querySelectorAll("#kokpit-custom-css")).toHaveLength(1);
    expect(document.getElementById("kokpit-custom-css")).toBe(serverStyle);
    expect(serverStyle.textContent).toBe("@layer user-custom { :root { --new: blue; } }");
    applyAppearance({ ...appearance, customCss: undefined });
    expect(document.getElementById("kokpit-custom-css")).toBe(serverStyle);
    expect(serverStyle.textContent).toBe("");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("removes every stale server background/card property while retaining unrelated styles", () => {
    const existing = {
      ...resolveBackgroundVars({ color: "red", blur: 8, brightness: 0.4, opacity: 0.5 }, 16),
      ...resolveBackgroundVars({ image: "/old.png" }, undefined),
    };
    for (const [property, value] of Object.entries(existing)) document.body.style.setProperty(property, value);
    document.body.style.setProperty("--owner-token", "green");
    document.body.style.margin = "2px";
    applyAppearance(resolveAppearance(config));
    for (const property of Object.keys(existing)) expect(document.body.style.getPropertyValue(property)).toBe("");
    expect(document.body.style.getPropertyValue("--owner-token")).toBe("green");
    expect(document.body.style.margin).toBe("2px");
  });

  it("switches image and card blur to a solid background, then removes that background", () => {
    applyAppearance(resolveAppearance({ ...config, appearance: {
      theme: "dark", background: { image: "/old.png", blur: 12, opacity: 0.2 }, card_blur: 4,
    } }));
    applyAppearance(resolveAppearance({ ...config, appearance: { theme: "high-contrast", background: { color: "#123456" } } }));
    expect(document.body.style.getPropertyValue("--app-bg-image")).toBe("");
    expect(document.body.style.getPropertyValue("--app-bg-blur")).toBe("");
    expect(document.body.style.getPropertyValue("--app-bg-overlay-opacity")).toBe("");
    expect(document.body.style.getPropertyValue("--card-blur")).toBe("");
    expect(document.body.style.getPropertyValue("--app-bg-color")).toBe("#123456");
    expect(document.documentElement).toHaveAttribute("data-theme", "high-contrast");
    applyAppearance(resolveAppearance(config));
    expect(document.body.style.getPropertyValue("--app-bg-color")).toBe("");
  });
});
