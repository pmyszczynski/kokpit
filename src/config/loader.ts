import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { parseDocument, stringify } from "yaml";
import { KokpitConfigSchema, type KokpitConfig } from "./schema";

const CONFIG_PATH =
  process.env.KOKPIT_CONFIG_PATH ??
  path.join(process.cwd(), "settings.yaml");

const DEFAULT_CONFIG = stringify(KokpitConfigSchema.parse({ schema_version: 1 }));

let cachedConfig: KokpitConfig | null = null;

// Services already warned about their deprecated `position` field, so each
// service is named at most once per process (loadConfig re-runs on every
// cache invalidation).
const warnedPositionServices = new Set<string>();

function warnDeprecatedPositions(config: KokpitConfig): void {
  for (const service of config.services) {
    if (!service.position) continue;
    const key = service.name.trim().toLowerCase();
    if (warnedPositionServices.has(key)) continue;
    warnedPositionServices.add(key);
    console.warn(
      `[kokpit] Service "${service.name}" uses the deprecated "position" field; ` +
        `use "size" (normal|wide|tall|large) and array order instead. ` +
        `"position" will be removed in a future schema version.`
    );
  }
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function loadConfig(): KokpitConfig {
  if (!existsSync(CONFIG_PATH)) {
    mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
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

  warnDeprecatedPositions(result.data);

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
