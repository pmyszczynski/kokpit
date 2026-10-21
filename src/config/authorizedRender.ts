import { isRequestAuthenticated } from "@/auth/apiAuth";
import { getConfigSnapshot, getPublishedConfigSnapshot } from "./server";
import type { KokpitConfig } from "./schema";

type AuthorizedRender = { state: "allowed"; snapshot: {
  state: "ready" | "migration-required"; config: KokpitConfig; source: string;
} } | { state: "unavailable" | "denied" };

/** Each RSC read authorizes its exact source, independently of a layout read. */
export async function getAuthorizedRenderSnapshot(): Promise<AuthorizedRender> {
  try {
    const snapshot = getConfigSnapshot();
    if ((snapshot.state !== "ready" && snapshot.state !== "migration-required") || !snapshot.config || !snapshot.source) {
      return { state: "unavailable" };
    }
    const allowed = await isRequestAuthenticated(snapshot.config);
    const current = getPublishedConfigSnapshot();
    if (current.state !== snapshot.state || current.source !== snapshot.source || current.config !== snapshot.config) {
      return { state: "unavailable" };
    }
    if (!allowed) return { state: "denied" };
    return { state: "allowed", snapshot: { state: snapshot.state, config: snapshot.config, source: snapshot.source } };
  } catch { return { state: "unavailable" }; }
}
