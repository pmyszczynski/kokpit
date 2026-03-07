import type { KokpitConfig } from "./schema";

export interface AppearanceProps {
  theme: string;
  customCss: string | undefined;
}

export function resolveAppearance(config: KokpitConfig): AppearanceProps {
  const theme = config.appearance.theme;
  const rawCss = config.appearance.custom_css;
  const customCss = rawCss
    ? rawCss.replace(/<[^>]*>/g, "")
    : undefined;
  return { theme, customCss };
}
