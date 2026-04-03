import type { KokpitConfig } from "./schema";

export interface AppearanceProps {
  theme: string;
  customCss: string | undefined;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function resolveAppearance(config: KokpitConfig): AppearanceProps {
  const theme = config.appearance.theme;
  const rawCss = config.appearance.custom_css;
  const customCss = rawCss
    ? escapeHtml(rawCss)
    : undefined;
  return { theme, customCss };
}
