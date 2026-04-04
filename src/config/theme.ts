import type { KokpitConfig } from "./schema";

export interface AppearanceProps {
  theme: string;
  customCss: string | undefined;
}

function stripHtmlTags(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

export function resolveAppearance(config: KokpitConfig): AppearanceProps {
  const theme = config.appearance.theme;
  const rawCss = config.appearance.custom_css;
  const customCss = rawCss ? stripHtmlTags(rawCss) : undefined;
  return { theme, customCss };
}
