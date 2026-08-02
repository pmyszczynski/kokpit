import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { parseDocument, stringify } from "yaml";
import { KokpitConfigSchema, widgetIntegrationRequirement, type KokpitConfig, type Size } from "./schema";

const CONFIG_PATH = process.env.KOKPIT_CONFIG_PATH ?? path.join(process.cwd(), "settings.yaml");
const DEFAULT_CONFIG = stringify(KokpitConfigSchema.parse({ schema_version: 2 }));
let cachedConfig: KokpitConfig | null = null;

type LegacyService = Record<string, unknown> & { name?: unknown; widget?: Record<string, unknown> };

const OPTION_KEYS: Record<string, ReadonlySet<string>> = {
  "sonarr-calendar": new Set(["days"]),
  "sonarr-queue": new Set(["limit"]),
  "radarr-queue": new Set(["limit"]),
  "qbittorrent-torrents": new Set(["limit", "filter"]),
  "seerr-requests": new Set(["limit", "filter"]),
  "actualbudget-categories": new Set(["limit", "category_ids", "timezone"]),
  "actualbudget-accounts": new Set(["account_ids", "timezone"]),
  "actualbudget-schedules": new Set(["days_ahead", "timezone"]),
  "actualbudget-summary": new Set(["timezone", "privacy_mode"]),
};

/** Explicit legacy widget -> reusable integration mapping. */
export function legacyIntegrationType(widgetType: string): string {
  return widgetIntegrationRequirement(widgetType) ?? widgetType;
}

export function splitLegacyWidgetConfig(widgetType: string, value: unknown) {
  const config = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const optionKeys = OPTION_KEYS[widgetType] ?? new Set<string>();
  const connection: Record<string, unknown> = {};
  const options: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(config)) (optionKeys.has(key) ? options : connection)[key] = item;
  return { connection, options };
}

function legacySize(service: LegacyService): Size | undefined {
  if (["normal", "wide", "tall", "large"].includes(String(service.size))) return service.size as Size;
  const position = service.position as { width?: unknown; height?: unknown } | undefined;
  if (!position) return undefined;
  const wide = Number(position.width) > 1;
  const tall = Number(position.height) > 1;
  return wide && tall ? "large" : wide ? "wide" : tall ? "tall" : "normal";
}

export function migrateV1Config(raw: Record<string, unknown>): KokpitConfig {
  const services: KokpitConfig["services"] = [];
  const service_tiles: KokpitConfig["service_tiles"] = [];
  if (!Array.isArray(raw.services)) throw new Error("services: expected an array");
  for (const [index, entry] of raw.services.entries()) {
    if (!entry || typeof entry !== "object") throw new Error(`services.${index}: expected an object`);
    const legacy = entry as LegacyService;
    if (typeof legacy.name !== "string" || !legacy.name.trim()) throw new Error(`services.${index}.name: expected a non-empty string`);
    const serviceId = randomUUID();
    const widget = legacy.widget;
    const widgetType = typeof widget?.type === "string" ? widget.type : undefined;
    const split = widgetType ? splitLegacyWidgetConfig(widgetType, widget?.config) : undefined;
    services.push({
      id: serviceId, name: legacy.name,
      ...(typeof legacy.url === "string" ? { launch_url: legacy.url } : {}),
      ...(typeof legacy.icon === "string" ? { icon: legacy.icon } : {}),
      ...(typeof legacy.description === "string" ? { description: legacy.description } : {}),
      ...(typeof legacy.group === "string" ? { category: legacy.group } : {}),
      ...(widgetType ? { integration: { type: legacyIntegrationType(widgetType), config: split!.connection } } : {}),
    });
    service_tiles.push({
      id: randomUUID(), service_id: serviceId,
      ...(typeof legacy.group === "string" ? { group: legacy.group } : {}),
      ...(legacySize(legacy) ? { size: legacySize(legacy) } : {}),
      ...(widgetType ? { widget: {
        type: widgetType,
        ...(Object.keys(split!.options).length ? { config: split!.options } : {}),
        ...(Array.isArray(widget?.fields) ? { fields: widget.fields.filter((v): v is string => typeof v === "string") } : {}),
        ...(typeof widget?.refresh_interval_ms === "number" ? { refresh_interval_ms: widget.refresh_interval_ms } : {}),
      } } : {}),
    });
  }
  return KokpitConfigSchema.parse({ ...raw, schema_version: 2, services, service_tiles });
}

function validationError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues.map((issue) => `  • ${issue.path.join(".")}: ${issue.message}`).join("\n");
}

export function getConfigPath(): string { return CONFIG_PATH; }

export function loadConfig(): KokpitConfig {
  if (!existsSync(CONFIG_PATH)) { mkdirSync(path.dirname(CONFIG_PATH), { recursive: true }); writeFileSync(CONFIG_PATH, DEFAULT_CONFIG, "utf-8"); }
  const source = readFileSync(CONFIG_PATH, "utf-8");
  const parsed = parseDocument(source).toJS() as unknown;
  if (!parsed || typeof parsed !== "object" || !("schema_version" in parsed)) throw new Error("Invalid settings.yaml:\n  • schema_version: Required (expected 1 for migration or 2)");
  const version = (parsed as Record<string, unknown>).schema_version;
  let config: KokpitConfig;
  if (version === 1) {
    try { config = migrateV1Config(parsed as Record<string, unknown>); }
    catch (error) { throw new Error(`Unable to migrate ${CONFIG_PATH} from schema v1: ${error instanceof Error ? error.message : String(error)}`); }
    const temp = `${CONFIG_PATH}.tmp-${process.pid}-${randomUUID()}`;
    const backup = `${CONFIG_PATH}.v1.bak`;
    try { writeFileSync(backup, source, { encoding: "utf-8", flag: "wx" }); writeFileSync(temp, stringify(config), "utf-8"); renameSync(temp, CONFIG_PATH); }
    catch (error) { try { if (existsSync(temp)) renameSync(temp, `${temp}.failed`); } catch {} throw new Error(`Unable to atomically migrate ${CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`); }
  } else if (version === 2) {
    const result = KokpitConfigSchema.safeParse(parsed);
    if (!result.success) throw new Error(`Invalid settings.yaml:\n${validationError(result.error)}`);
    config = result.data;
  } else throw new Error(`Invalid settings.yaml:\n  • schema_version: Unsupported version ${String(version)} (expected 1 for migration or 2)`);
  cachedConfig = config; return config;
}

export function getConfig(): KokpitConfig { return cachedConfig ?? loadConfig(); }
export function writeConfig(updates: Partial<KokpitConfig>): void {
  const candidate = KokpitConfigSchema.parse({ ...getConfig(), ...updates });
  const temp = `${CONFIG_PATH}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temp, stringify(candidate), "utf-8"); renameSync(temp, CONFIG_PATH); invalidateCache();
}
export function invalidateCache(): void { cachedConfig = null; }
