import type { KokpitConfig } from "./schema";

export interface AppearanceProps {
  theme: string;
  customCss: string | undefined;
}

function sanitizeCss(input: string): string {
  // Only neutralise sequences that would close the surrounding <style> tag.
  // All other CSS (child combinators, quoted values, etc.) must pass through unchanged.
  return input.replace(/<\/style/gi, (match) => `<\\/${match.slice(2)}`);
}

export function resolveAppearance(config: KokpitConfig): AppearanceProps {
  const theme = config.appearance.theme;
  const rawCss = config.appearance.custom_css;
  const customCss = rawCss ? sanitizeCss(rawCss) : undefined;
  return { theme, customCss };
}
