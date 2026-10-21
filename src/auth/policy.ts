import type { KokpitConfig } from "@/config/schema";

export function isAuthenticationEnabled(config: KokpitConfig): boolean {
  return config.auth.enabled && process.env.KOKPIT_AUTH_DISABLED !== "true";
}
