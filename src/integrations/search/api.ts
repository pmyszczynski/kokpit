import { z } from "zod";

export function searchUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !value.includes("#") ? url : null;
  } catch { return null; }
}

export const SearchConfigSchema = z.object({
  search_url: z.string().trim().min(1).max(2048).refine(value => searchUrl(value) !== null, "Enter an HTTP(S) search URL without credentials or a fragment").default("https://duckduckgo.com/"),
  query_parameter: z.string().trim().min(1).max(80).regex(/^[^\s&=#?]+$/u, "Enter a single query parameter name").default("q"),
  engine_name: z.string().trim().max(80).default(""),
  new_tab: z.boolean().default(true),
});
export type SearchConfig = z.input<typeof SearchConfigSchema>;
export interface SearchData {
  action: string;
  queryParameter: string;
  parameters: [string, string][];
  engineName: string;
  newTab: boolean;
}

/** Resolve saved options only. Search queries go directly from browser to engine. */
export async function fetchSearch(input: SearchConfig, signal?: AbortSignal): Promise<SearchData> {
  signal?.throwIfAborted();
  const config = SearchConfigSchema.parse(input);
  const url = searchUrl(config.search_url)!;
  const parameters = [...url.searchParams.entries()].filter(([name]) => name !== config.query_parameter);
  url.search = "";
  const known = new Map([["duckduckgo.com", "DuckDuckGo"], ["www.duckduckgo.com", "DuckDuckGo"], ["www.google.com", "Google"], ["google.com", "Google"]]);
  return { action: url.href, queryParameter: config.query_parameter, parameters,
    engineName: config.engine_name || known.get(url.hostname) || url.host, newTab: config.new_tab };
}
