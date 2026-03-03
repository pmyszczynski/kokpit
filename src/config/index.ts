// Config module — Phase 1 (YAML config engine task) will fill this out.
// Responsibilities:
//   - Parse settings.yaml (using the `yaml` npm package)
//   - Validate schema with Zod
//   - Watch for file changes (dev hot-reload)
//   - Provide typed access to config values
//
// DO NOT use this placeholder directly. It will be replaced.

// Full schema defined in Phase 1 alongside the YAML config engine
export type KokpitConfig = Record<string, unknown>;

export async function loadConfig(): Promise<KokpitConfig> {
  throw new Error("Config engine not yet implemented (Phase 1)");
}
