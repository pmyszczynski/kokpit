import type { Background, KokpitConfig } from "./schema";

export interface AppearanceProps {
  theme: string;
  customCss: string | undefined;
  /**
   * CSS custom properties to set inline on the document (server-rendered, no
   * hydration flash). Empty when no background/card_blur is configured, so the
   * default appearance is byte-identical to today.
   */
  bgStyle: Record<string, string>;
}

function sanitizeCss(input: string): string {
  // Only neutralise sequences that would close the surrounding <style> tag.
  // All other CSS (child combinators, quoted values, etc.) must pass through unchanged.
  return input.replace(/<\/style/gi, (match) => `<\\/${match.slice(2)}`);
}

// A CSS custom-property value ends up inside an inline style attribute; strip
// characters that could terminate the declaration or the attribute so a config
// value can't inject sibling declarations. (The config owner can already write
// arbitrary custom_css, so this is defense-in-depth, not a trust boundary.)
function cssValue(input: string): string {
  return input.replace(/[;{}<>]/g, "").trim();
}

// url() token for a background image path. Wrapped in double quotes with the
// quote/backslash escaped, so the value can't break out of the url().
function cssUrl(input: string): string {
  const escaped = input.replace(/[\\"]/g, (m) => `\\${m}`).replace(/[\r\n]/g, "");
  return `url("${escaped}")`;
}

/**
 * Pure: turn an appearance's `background` + `card_blur` into the CSS custom
 * properties the globals.css background layers and frosted-glass indirection
 * read. Returns an empty object when nothing is configured — the layers stay
 * unpainted (display:none) and cards keep opaque `var(--color-surface)`.
 *
 * Paint-source precedence is last-wins over the BackgroundSchema key order
 * (color → gradient → image): image beats gradient beats color.
 */
export function resolveBackgroundVars(
  background: Background | undefined,
  cardBlur: number | undefined
): Record<string, string> {
  const vars: Record<string, string> = {};

  if (background) {
    // Paint source (mutually last-wins).
    if (background.image) {
      vars["--app-bg-image"] = cssUrl(background.image);
      vars["--app-bg-display"] = "block";
    } else if (background.gradient) {
      vars["--app-bg-image"] = cssValue(background.gradient);
      vars["--app-bg-display"] = "block";
    } else if (background.color) {
      vars["--app-bg-color"] = cssValue(background.color);
      vars["--app-bg-display"] = "block";
    }

    // Filters on the paint layer.
    if (typeof background.blur === "number") {
      vars["--app-bg-blur"] = `${background.blur}px`;
    }
    if (typeof background.brightness === "number") {
      vars["--app-bg-brightness"] = String(background.brightness);
    }

    // Theme-tinted overlay (independent of the paint source — can dim a plain
    // themed dashboard too).
    if (typeof background.opacity === "number" && background.opacity > 0) {
      vars["--app-bg-overlay-opacity"] = String(background.opacity);
      vars["--app-bg-overlay-display"] = "block";
    }
  }

  // Frosted glass: opt-in only. card_blur > 0 swaps cards to the translucent
  // surface token and enables the backdrop-filter; unset/0 leaves the fallbacks
  // (opaque --color-surface, backdrop none) in place.
  if (typeof cardBlur === "number" && cardBlur > 0) {
    vars["--card-blur"] = `${cardBlur}px`;
    vars["--card-backdrop"] = "blur(var(--card-blur))";
    vars["--card-surface"] = "var(--color-surface-translucent)";
    vars["--card-surface-hover"] = "var(--color-surface-2-translucent)";
  }

  return vars;
}

export function resolveAppearance(config: KokpitConfig): AppearanceProps {
  const theme = config.appearance.theme;
  const rawCss = config.appearance.custom_css;
  const customCss = rawCss ? sanitizeCss(rawCss) : undefined;
  const bgStyle = resolveBackgroundVars(
    config.appearance.background,
    config.appearance.card_blur
  );
  return { theme, customCss, bgStyle };
}
