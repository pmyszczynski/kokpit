import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { parseDocument } from "yaml";
import { KokpitConfigSchema, type KokpitConfig } from "./schema";

const CONFIG_PATH =
  process.env.KOKPIT_CONFIG_PATH ??
  path.join(process.cwd(), "settings.yaml");

const DEFAULT_CONFIG = `schema_version: 1\nauth:\n  enabled: true\n  session_ttl_hours: 24\nappearance:\n  theme: dark\nlayout:\n  columns: 4\n  row_height: 120\nservices: []\n`;

let cachedConfig: KokpitConfig | null = null;

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function loadConfig(): KokpitConfig {
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, DEFAULT_CONFIG, "utf-8");
  }
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const parsed = parseDocument(raw).toJS() as unknown;
  const result = KokpitConfigSchema.safeParse(parsed);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  • ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid settings.yaml:\n${messages}`);
  }

  cachedConfig = result.data;
  return cachedConfig;
}

export function getConfig(): KokpitConfig {
  if (!cachedConfig) return loadConfig();
  return cachedConfig;
}

export function writeConfig(updates: Partial<KokpitConfig>): void {
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const doc = parseDocument(raw);

  for (const [key, value] of Object.entries(updates)) {
    doc.setIn([key], value);
  }

  writeFileSync(CONFIG_PATH, doc.toString(), "utf-8");
  invalidateCache();
}

export function invalidateCache(): void {
  cachedConfig = null;
}
