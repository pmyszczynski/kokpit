import { z } from "zod";
import { fetchWithApiKey } from "@/integrations/shared/http";

export interface ImmichConfig {
  url: string;
  api_key: string;
}

export const ImmichConfigSchema = z.object({
  url: z.string().url(),
  api_key: z.string().min(1),
});

export interface ImmichStats {
  photos: number;
  videos: number;
  usage: number;
  usagePhotos: number;
  usageVideos: number;
}

const ImmichStatsResponseSchema = z.object({
  photos: z.number(),
  videos: z.number(),
  usage: z.number(),
  usagePhotos: z.number(),
  usageVideos: z.number(),
});

function normalizeImmichApiUrl(url: string): string {
  const parsed = new URL(url);
  const pathname = parsed.pathname.replace(/\/+$/, "");

  if (pathname === "" || pathname === "/") {
    parsed.pathname = "/api/";
    return parsed.toString();
  }

  if (pathname.endsWith("/api")) {
    parsed.pathname = `${pathname}/`;
    return parsed.toString();
  }

  parsed.pathname = `${pathname}/api/`;
  return parsed.toString();
}

export async function fetchStats(
  config: ImmichConfig,
  signal?: AbortSignal
): Promise<ImmichStats> {
  const normalizedConfig = {
    ...config,
    url: normalizeImmichApiUrl(config.url),
  };
  const response = await fetchWithApiKey(
    normalizedConfig,
    "server/statistics",
    signal,
    "Immich"
  );
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Immich returned invalid JSON. Ensure the widget URL points to your Immich API (usually ending with /api)."
    );
  }
  return ImmichStatsResponseSchema.parse(data);
}
