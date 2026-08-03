import { randomUUID } from "crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs";
import path from "path";
import { parseDocument, stringify } from "yaml";
import { KokpitConfigSchema, widgetIntegrationRequirement, type KokpitConfig, type Size } from "./schema";
import { splitWidgetConfig } from "@/components/edit/serviceFormProjection";
import { canonicalJSONString } from "./canonicalJson";
import { configRevision } from "./revision";

const CONFIG_PATH = process.env.KOKPIT_CONFIG_PATH ?? path.join(process.cwd(), "settings.yaml");
const DEFAULT_CONFIG = stringify(KokpitConfigSchema.parse({ schema_version: 2 }));
let cachedConfig: KokpitConfig | null = null;

type LegacyService = Record<string, unknown> & { name?: unknown; widget?: Record<string, unknown> };


/** Explicit legacy widget -> reusable integration mapping. */
export function legacyIntegrationType(widgetType: string): string | null {
  return widgetIntegrationRequirement(widgetType);
}

export function splitLegacyWidgetConfig(widgetType: string, value: unknown) {
  return splitWidgetConfig(widgetType, value);
}

function widgetConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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
  const integrationServices = new Map<string, string>();
  const legacyServices = raw.services ?? [];
  if (!Array.isArray(legacyServices)) throw new Error("services: expected an array");
  for (const [index, entry] of legacyServices.entries()) {
    if (!entry || typeof entry !== "object") throw new Error(`services.${index}: expected an object`);
    const legacy = entry as LegacyService;
    if (typeof legacy.name !== "string" || !legacy.name.trim()) throw new Error(`services.${index}.name: expected a non-empty string`);
    const widget = legacy.widget;
    const widgetType = typeof widget?.type === "string" ? widget.type : undefined;
    const integrationType = widgetType ? legacyIntegrationType(widgetType) : null;
    const split = integrationType !== null && widgetType
      ? splitLegacyWidgetConfig(widgetType, widget?.config)
      : { connection: {}, options: widgetConfig(widget?.config) };
    // A Service owns both its connection and its presentation.  Sharing a
    // backend is only safe when the legacy cards would produce the same Service.
    const presentation = {
      name: legacy.name,
      ...(typeof legacy.url === "string" ? { launch_url: legacy.url } : {}),
      ...(typeof legacy.icon === "string" ? { icon: legacy.icon } : {}),
      ...(typeof legacy.description === "string" ? { description: legacy.description } : {}),
      ...(typeof legacy.group === "string" ? { category: legacy.group } : {}),
    };
    const integrationKey = integrationType
      ? `${integrationType}:${canonicalJSONString({ connection: split.connection, presentation })}`
      : undefined;
    let serviceId = integrationKey ? integrationServices.get(integrationKey) : undefined;
    if (!serviceId) {
      serviceId = randomUUID();
      services.push({
        id: serviceId, name: legacy.name,
        ...(typeof legacy.url === "string" ? { launch_url: legacy.url } : {}),
        ...(typeof legacy.icon === "string" ? { icon: legacy.icon } : {}),
        ...(typeof legacy.description === "string" ? { description: legacy.description } : {}),
        ...(typeof legacy.group === "string" ? { category: legacy.group } : {}),
        ...(integrationType ? { integration: { type: integrationType, config: split.connection } } : {}),
      });
      if (integrationKey) integrationServices.set(integrationKey, serviceId);
    }
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
  if (!existsSync(CONFIG_PATH)) {
    mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, DEFAULT_CONFIG, { encoding: "utf-8", mode: 0o600 });
    try { chmodSync(CONFIG_PATH, 0o600); } catch { /* creation mode is already restrictive */ }
  }
  const source = readFileSync(CONFIG_PATH, "utf-8");
  const parsed = parseDocument(source).toJS() as unknown;
  if (!parsed || typeof parsed !== "object" || !("schema_version" in parsed)) throw new Error("Invalid settings.yaml:\n  • schema_version: Required (expected 1 for migration or 2)");
  const version = (parsed as Record<string, unknown>).schema_version;
  let config: KokpitConfig;
  if (version === 1) {
    try { config = migrateV1Config(parsed as Record<string, unknown>); }
    catch (error) { throw new Error(`Unable to migrate ${CONFIG_PATH} from schema v1: ${error instanceof Error ? error.message : String(error)}`); }
    const temp = `${CONFIG_PATH}.tmp-${process.pid}-${randomUUID()}`;
    let backup = `${CONFIG_PATH}.v1.bak`;
    if (existsSync(backup) && readFileSync(backup, "utf-8") !== source) backup = `${backup}.${randomUUID()}`;
    const sourceMode = statSync(CONFIG_PATH).mode & 0o777;
    try {
      if (!existsSync(backup)) {
        writeFileSync(backup, source, { encoding: "utf-8", flag: "wx", mode: sourceMode });
        chmodSync(backup, sourceMode);
      }
      writeFileSync(temp, stringify(config), { encoding: "utf-8", mode: sourceMode });
      chmodSync(temp, sourceMode);
      renameSync(temp, CONFIG_PATH);
    }
    catch (error) { try { if (existsSync(temp)) renameSync(temp, `${temp}.failed`); } catch {} throw new Error(`Unable to atomically migrate ${CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`); }
  } else if (version === 2) {
    const result = KokpitConfigSchema.safeParse(parsed);
    if (!result.success) throw new Error(`Invalid settings.yaml:\n${validationError(result.error)}`);
    config = result.data;
  } else throw new Error(`Invalid settings.yaml:\n  • schema_version: Unsupported version ${String(version)} (expected 1 for migration or 2)`);
  cachedConfig = config; return config;
}

export function getConfig(): KokpitConfig { return cachedConfig ?? loadConfig(); }
export class ConfigRevisionMismatchError extends Error {
  constructor(readonly currentRevision: string) {
    super("settings.yaml changed before it could be written");
    this.name = "ConfigRevisionMismatchError";
  }
}

export function writeConfig(
  updates: Partial<KokpitConfig>,
  expectedRevision?: string
): void {
  KokpitConfigSchema.parse({ ...getConfig(), ...updates });
  const doc = parseDocument(readFileSync(CONFIG_PATH, "utf-8"));
  const current = KokpitConfigSchema.parse(doc.toJS());
  if (expectedRevision !== undefined && configRevision(current) !== expectedRevision) {
    throw new ConfigRevisionMismatchError(configRevision(current));
  }
  const temp = `${CONFIG_PATH}.tmp-${process.pid}-${randomUUID()}`;
  for (const [key, value] of Object.entries(updates)) doc.setIn([key], value);
  // Parse the exact document that will be persisted, not just the in-memory merge.
  KokpitConfigSchema.parse(doc.toJS());
  let mode = 0o600;
  try {
    if (existsSync(CONFIG_PATH)) mode = statSync(CONFIG_PATH).mode & 0o777;
  } catch {
    // Test doubles and unusual filesystems may not expose mode metadata.
  }
  writeFileSync(temp, doc.toString(), { encoding: "utf-8", mode });
  try { chmodSync(temp, mode); } catch { /* write mode is already restrictive */ }
  renameSync(temp, CONFIG_PATH); invalidateCache();
}
export function invalidateCache(): void { cachedConfig = null; }
