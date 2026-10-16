import { z } from "zod";

export function articleUrl(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export const RssConfigSchema = z.object({
  feed_url: z.string().trim().min(1).max(2048).refine(value => articleUrl(value) !== null, "Enter an HTTP(S) feed URL without credentials"),
  max_items: z.number().int().min(1).max(50).default(10),
});
export type RssConfig = z.input<typeof RssConfigSchema>;
export interface FeedArticle { title: string; url: string | null; publishedAt: string | null; summary: string }
export interface RssData { title: string; articles: FeedArticle[] }

export async function fetchRss(config: RssConfig, signal?: AbortSignal): Promise<RssData> {
  if (typeof window === "undefined") {
    const { fetchFeed } = await import("./server");
    return fetchFeed(config, signal);
  }
  throw new Error("Feed data is fetched server-side");
}
