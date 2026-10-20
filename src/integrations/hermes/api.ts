import { z } from "zod";

export const HermesConfigSchema = z.object({
  url: z.string().trim().max(2048).refine(value => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }, "Enter an HTTP(S) API server URL without credentials, query or fragment"),
  api_key: z.string().trim().min(1).max(4096).regex(/^[\x21-\x7e]+$/, "Enter a valid API server key"),
});
export type HermesConfig = z.infer<typeof HermesConfigSchema>;
export type HermesSectionState = "available" | "unsupported" | "unavailable";
export interface HermesSession { id: string; title: string; source: string; lastActive: string | null }
export interface HermesJob { name: string; nextRun: string; lastStatus: string | null }
export interface HermesData {
  health: "ready" | "degraded" | "online" | "unknown";
  activeApiRuns: number | null;
  jobsState: HermesSectionState;
  scheduledJobs: number | null;
  failedJobs: number | null;
  nextJob: HermesJob | null;
  sessionsState: HermesSectionState;
  sessions: HermesSession[];
}

export async function fetchHermes(config: HermesConfig, signal?: AbortSignal): Promise<HermesData> {
  if (typeof window === "undefined") {
    const { fetchOverview } = await import("./server");
    return fetchOverview(config, signal);
  }
  throw new Error("Hermes data is fetched server-side");
}
