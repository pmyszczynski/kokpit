import type { AppearanceProps } from "@/config/theme";

// These are the properties owned by resolveBackgroundVars, including the
// server-rendered values that may need removing on the first reconciliation.
const BACKGROUND_PROPERTIES = [
  "--app-bg-image", "--app-bg-color", "--app-bg-display", "--app-bg-blur",
  "--app-bg-brightness", "--app-bg-overlay-opacity", "--app-bg-overlay-display",
  "--card-blur", "--card-backdrop", "--card-surface", "--card-surface-hover",
] as const;

/** Apply the already-resolved appearance selected by the configuration owner. */
export function applyAppearance({ theme, customCss, bgStyle }: AppearanceProps): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  for (const property of BACKGROUND_PROPERTIES) {
    if (!(property in bgStyle)) document.body.style.removeProperty(property);
  }
  for (const [property, value] of Object.entries(bgStyle)) {
    document.body.style.setProperty(property, value);
  }

  let style = document.getElementById("kokpit-custom-css");
  if (!style) {
    style = document.createElement("style");
    style.id = "kokpit-custom-css";
    document.body.prepend(style);
  }
  // textContent keeps arbitrary owner CSS as text; never parse it as markup.
  const css = customCss ? `@layer user-custom { ${customCss} }` : "";
  if (style.textContent !== css) style.textContent = css;
}
