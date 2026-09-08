import { randomUUID } from "crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import path from "path";
import { lockSync } from "proper-lockfile";
import { isMap, isNode, isScalar, isSeq, parseDocument, stringify, type Node, type YAMLMap } from "yaml";
import "@/integrations";
import { KokpitConfigSchema, widgetIntegrationRequirement, type KokpitConfig, type Size } from "./schema";
import { splitWidgetConfig } from "@/widgets/configBoundary";
import { getWidget } from "@/widgets";
import { canonicalJSONString } from "./canonicalJson";
import { configRevision } from "./revision";
import { GENERIC_SERVICE_FOOTPRINT, isTileFootprint, legacyWidgetFootprint } from "@/layout/grid";
import { resolveServiceSize } from "./resolve";

const CONFIG_PATH = process.env.KOKPIT_CONFIG_PATH ?? path.join(process.cwd(), "settings.yaml");
const CONFIG_DISPLACED_PATH = `${CONFIG_PATH}.displaced`;
const CONFIG_LOCK_TIMEOUT_MS = 5_000;
const CONFIG_REWRITE_ATTEMPTS = 3;
const LOCK_WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4));
const DEFAULT_CONFIG = stringify(KokpitConfigSchema.parse({ schema_version: 2 }));
const CONFIG_CACHE_KEY = Symbol.for("kokpit.config.loader.cache");

export type ConfigCacheState = "cold" | "ready" | "dirty" | "migration-required";

type ConfigCache = {
  path: string;
  config: KokpitConfig | null;
  source: string | null;
  pendingSource: string | null;
  state: ConfigCacheState;
  refreshTimer: ReturnType<typeof setTimeout> | null;
  refreshRetryDelayMs: number;
};

export type ConfigSnapshot = {
  state: ConfigCacheState;
  config: KokpitConfig | null;
  source: string | null;
};

export class ConfigUnavailableError extends Error {
  constructor() {
    super("settings.yaml is being updated; retry once the change is complete");
    this.name = "ConfigUnavailableError";
  }
}

function configCache(): ConfigCache {
  const host = globalThis as typeof globalThis & Record<symbol, ConfigCache | undefined>;
  const cache = host[CONFIG_CACHE_KEY] ?? (host[CONFIG_CACHE_KEY] = {
    path: CONFIG_PATH,
    config: null,
    source: null,
    pendingSource: null,
    state: "cold",
    refreshTimer: null,
    refreshRetryDelayMs: 100,
  });
  // Fill fields added during development when a hot-reloaded module observes
  // an older process-wide cache object.
  cache.refreshTimer ??= null;
  cache.refreshRetryDelayMs ??= 100;
  if (
    cache.path !== CONFIG_PATH
    || !(["cold", "ready", "dirty", "migration-required"] as const).includes(cache.state)
  ) {
    if (cache.refreshTimer) clearTimeout(cache.refreshTimer);
    cache.path = CONFIG_PATH;
    cache.config = null;
    cache.source = null;
    cache.pendingSource = null;
    cache.state = "cold";
    cache.refreshTimer = null;
    cache.refreshRetryDelayMs = 100;
  }
  return cache;
}

type LegacyService = Record<string, unknown> & { name?: unknown; widget?: Record<string, unknown> };

function sameFootprint(
  left: { columnSpan: number; rowSpan: number },
  right: { columnSpan: number; rowSpan: number }
): boolean {
  return left.columnSpan === right.columnSpan && left.rowSpan === right.rowSpan;
}

function widgetDefinitionForTile(tile: Record<string, unknown>) {
  return isRecord(tile.widget) && typeof tile.widget.type === "string"
    ? getWidget(tile.widget.type)
    : undefined;
}

/** One-way KOK-83 migration. It preserves tile identity/order/configuration. */
export function migrateFixedGridConfig(raw: Record<string, unknown>): KokpitConfig {
  const tiles = Array.isArray(raw.service_tiles) ? raw.service_tiles.map((entry) => {
    if (!isRecord(entry)) return entry;
    const { size, footprint: savedFootprint, ...tile } = entry;
    const legacySize = ["normal", "wide", "tall", "large"].includes(String(size))
      ? size as Size
      : undefined;
    const definition = widgetDefinitionForTile(entry);
    const effectiveWidgetSize = definition
      ? resolveServiceSize(
          legacySize ? { size: legacySize } : {},
          definition.preferredSize,
          definition.minSize
        )
      : legacySize;
    const hintedWidgetFootprint = legacyWidgetFootprint(effectiveWidgetSize);
    const supportedFootprints = definition?.supportedFootprints;
    const supportedFallback = supportedFootprints?.find((candidate) =>
      sameFootprint(candidate, hintedWidgetFootprint)
    ) ?? supportedFootprints?.[0];
    // Generic service cards are always 3×1. Compact canvases deliberately omit
    // secondary content such as descriptions rather than changing geometry.
    const fallback = entry.widget
      ? supportedFallback ?? hintedWidgetFootprint
      : GENERIC_SERVICE_FOOTPRINT;
    const normalizeSpan = (value: unknown, fallbackValue: number) => {
      const numeric = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallbackValue;
      return Math.max(1, numeric);
    };
    const normalized = isRecord(savedFootprint) ? {
      columnSpan: normalizeSpan(savedFootprint.columnSpan, fallback.columnSpan),
      rowSpan: normalizeSpan(savedFootprint.rowSpan, fallback.rowSpan),
    } : fallback;
    const supported = supportedFootprints?.length
      ? supportedFootprints.some((candidate) => sameFootprint(candidate, normalized))
        ? normalized
        : supportedFallback!
      : normalized;
    const footprint = entry.widget
      ? { columnSpan: supported.columnSpan, rowSpan: supported.rowSpan }
      : { ...GENERIC_SERVICE_FOOTPRINT };
    return { ...tile, footprint };
  }) : raw.service_tiles;
  const oldLayout = isRecord(raw.layout) ? raw.layout : {};
  const layout = oldLayout.ungrouped === "first" ? { ungrouped: "first" } : {};
  const groups = Array.isArray(raw.groups) ? raw.groups.map((entry) => {
    if (!isRecord(entry)) return entry;
    const { columns: _columns, ...group } = entry;
    return group;
  }) : raw.groups;
  return KokpitConfigSchema.parse({ ...raw, layout, groups, service_tiles: tiles });
}

function needsFixedGridMigration(raw: Record<string, unknown>): boolean {
  const layout = isRecord(raw.layout) ? raw.layout : {};
  if (["columns", "row_height", "tablet", "mobile"].some((key) => key in layout)) return true;
  if (Array.isArray(raw.groups) && raw.groups.some((group) => isRecord(group) && "columns" in group)) return true;
  return Array.isArray(raw.service_tiles) && raw.service_tiles.some((tile) => {
    if (!isRecord(tile)) return true;
    const footprint = tile.footprint;
    if ("size" in tile || !isTileFootprint(footprint)) return true;
    const supported = widgetDefinitionForTile(tile)?.supportedFootprints;
    if (supported?.length && !supported.some((candidate) => sameFootprint(candidate, footprint))) {
      return true;
    }
    return !tile.widget && !sameFootprint(footprint, GENERIC_SERVICE_FOOTPRINT);
  });
}


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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Reject known legacy fields that migration would otherwise discard or coerce. */
function validateLegacyService(service: LegacyService, index: number): void {
  const allowedServiceKeys = new Set([
    "name", "url", "icon", "description", "group", "size", "position", "widget",
  ]);
  const unknownServiceKey = Object.keys(service).find((key) => !allowedServiceKeys.has(key));
  if (unknownServiceKey) {
    throw new Error(`services.${index}.${unknownServiceKey}: unsupported legacy field`);
  }
  if (typeof service.name !== "string" || !service.name.trim()) {
    throw new Error(`services.${index}.name: expected a non-empty string`);
  }
  for (const field of ["url", "icon", "description", "group"] as const) {
    if (service[field] !== undefined && typeof service[field] !== "string") {
      throw new Error(`services.${index}.${field}: expected a string`);
    }
  }
  if (service.size !== undefined && !["normal", "wide", "tall", "large"].includes(String(service.size))) {
    throw new Error(`services.${index}.size: expected normal, wide, tall, or large`);
  }
  if (service.position !== undefined) {
    if (!isRecord(service.position)) throw new Error(`services.${index}.position: expected an object`);
    const unknownPositionKey = Object.keys(service.position).find(
      (key) => !["col", "row", "width", "height"].includes(key)
    );
    if (unknownPositionKey) {
      throw new Error(`services.${index}.position.${unknownPositionKey}: unsupported legacy field`);
    }
    for (const field of ["col", "row", "width", "height"] as const) {
      if (!Number.isInteger(service.position[field]) || Number(service.position[field]) <= 0) {
        throw new Error(`services.${index}.position.${field}: expected a positive integer`);
      }
    }
  }
  if (service.widget !== undefined) {
    if (!isRecord(service.widget)) throw new Error(`services.${index}.widget: expected an object`);
    const unknownWidgetKey = Object.keys(service.widget).find(
      (key) => !["type", "config", "fields", "refresh_interval_ms"].includes(key)
    );
    if (unknownWidgetKey) {
      throw new Error(`services.${index}.widget.${unknownWidgetKey}: unsupported legacy field`);
    }
    if (typeof service.widget.type !== "string" || !service.widget.type) {
      throw new Error(`services.${index}.widget.type: expected a non-empty string`);
    }
    if (service.widget.config !== undefined && !isRecord(service.widget.config)) {
      throw new Error(`services.${index}.widget.config: expected an object`);
    }
    if (service.widget.fields !== undefined && (!Array.isArray(service.widget.fields) || service.widget.fields.some((field) => typeof field !== "string"))) {
      throw new Error(`services.${index}.widget.fields: expected an array of strings`);
    }
    if (service.widget.refresh_interval_ms !== undefined &&
      (!Number.isInteger(service.widget.refresh_interval_ms) || Number(service.widget.refresh_interval_ms) < 5000)) {
      throw new Error(`services.${index}.widget.refresh_interval_ms: expected an integer of at least 5000`);
    }
  }
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
    validateLegacyService(legacy, index);
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
        id: serviceId, name: legacy.name as string,
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

type ConfigShape = "legacy" | "v2" | "neutral" | "mixed";

function classifyConfigShape(raw: Record<string, unknown>): ConfigShape {
  const hasServiceTiles = Object.prototype.hasOwnProperty.call(raw, "service_tiles");
  if (!Array.isArray(raw.services)) return hasServiceTiles ? "v2" : "neutral";
  let legacy = false;
  let v2 = hasServiceTiles;
  for (const entry of raw.services) {
    if (!isRecord(entry)) {
      legacy = true;
      continue;
    }
    const hasV2 = ["id", "launch_url", "category", "integration"].some((key) => key in entry);
    const hasLegacy = ["url", "group", "size", "position", "widget"].some((key) => key in entry)
      || (Object.keys(entry).length > 0 && !hasV2);
    v2 ||= hasV2;
    legacy ||= hasLegacy;
  }
  return legacy && v2 ? "mixed" : legacy ? "legacy" : v2 ? "v2" : "neutral";
}

function validationError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues.map((issue) => `  • ${issue.path.join(".")}: ${issue.message}`).join("\n");
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function parseSettingsDocument(source: string) {
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    throw new Error(
      `Invalid settings.yaml:\n${document.errors.map((error) => `  • ${error.message}`).join("\n")}`
    );
  }
  return document;
}

function copyNodeComments(source: Node | null | undefined, target: Node | null | undefined): void {
  if (!source || !target) return;
  const merge = (current: string | null | undefined, incoming: string | null | undefined) => {
    if (!incoming) return current;
    if (!current) return incoming;
    return current.split("\n").includes(incoming) ? current : `${current}\n${incoming}`;
  };
  target.commentBefore = merge(target.commentBefore, source.commentBefore);
  target.comment = merge(target.comment, source.comment);
  target.spaceBefore ||= source.spaceBefore;
}

function mapPair(map: YAMLMap, key: string) {
  return map.items.find((pair) => isScalar(pair.key) && pair.key.value === key);
}

function copyPairComments(source: YAMLMap, target: YAMLMap, sourceKey: string, targetKey = sourceKey): void {
  const sourcePair = mapPair(source, sourceKey);
  const targetPair = mapPair(target, targetKey);
  if (!sourcePair || !targetPair) return;
  if (isNode(sourcePair.key) && isNode(targetPair.key)) copyNodeComments(sourcePair.key, targetPair.key);
  if (isNode(sourcePair.value) && isNode(targetPair.value)) copyNodeComments(sourcePair.value, targetPair.value);
}

function copyMatchingMapComments(source: YAMLMap, target: YAMLMap): void {
  copyNodeComments(source, target);
  for (const sourcePair of source.items) {
    if (!isScalar(sourcePair.key) || typeof sourcePair.key.value !== "string") continue;
    const targetPair = mapPair(target, sourcePair.key.value);
    if (!targetPair) continue;
    if (isNode(sourcePair.key) && isNode(targetPair.key)) copyNodeComments(sourcePair.key, targetPair.key);
    if (isNode(sourcePair.value) && isNode(targetPair.value)) {
      copyNodeComments(sourcePair.value, targetPair.value);
      if (isMap(sourcePair.value) && isMap(targetPair.value)) {
        copyMatchingMapComments(sourcePair.value, targetPair.value);
      }
    }
  }
}

function setMigratedServiceNodes(
  document: ReturnType<typeof parseSettingsDocument>,
  config: KokpitConfig
): void {
  const legacyServices = document.get("services", true);
  const services = document.createNode(config.services);
  const serviceTiles = document.createNode(config.service_tiles);
  if (isSeq(legacyServices) && isSeq(services) && isSeq(serviceTiles)) {
    copyNodeComments(legacyServices, services);
    const serviceIndexes = new Map(config.services.map((service, index) => [service.id, index]));
    for (const [index, legacyNode] of legacyServices.items.entries()) {
      const tileNode = serviceTiles.items[index];
      const tile = config.service_tiles[index];
      const serviceIndex = tile ? serviceIndexes.get(tile.service_id) : undefined;
      const serviceNode = serviceIndex === undefined ? undefined : services.items[serviceIndex];
      if (!isMap(legacyNode) || !isMap(tileNode)) continue;

      copyNodeComments(legacyNode, tileNode);
      for (const [sourceKey, targetKey] of [["group", "group"], ["size", "size"], ["position", "size"], ["widget", "widget"]]) {
        copyPairComments(legacyNode, tileNode, sourceKey, targetKey);
      }
      const legacyWidget = mapPair(legacyNode, "widget")?.value;
      const tileWidget = mapPair(tileNode, "widget")?.value;
      if (isMap(legacyWidget) && isMap(tileWidget)) copyMatchingMapComments(legacyWidget, tileWidget);

      if (!tile || !isMap(serviceNode)) continue;
      for (const [sourceKey, targetKey] of [
        ["name", "name"], ["url", "launch_url"], ["icon", "icon"],
        ["description", "description"], ["group", "category"],
      ]) {
        copyPairComments(legacyNode, serviceNode, sourceKey, targetKey);
      }
      const legacyWidgetConfig = isMap(legacyWidget) ? mapPair(legacyWidget, "config")?.value : undefined;
      const integration = mapPair(serviceNode, "integration")?.value;
      const integrationConfig = isMap(integration) ? mapPair(integration, "config")?.value : undefined;
      if (isMap(legacyWidgetConfig) && isMap(integrationConfig)) {
        copyMatchingMapComments(legacyWidgetConfig, integrationConfig);
      }
    }
  }
  document.set("services", services);
  document.set("service_tiles", serviceTiles);
}

function setFixedGridNodes(
  document: ReturnType<typeof parseSettingsDocument>,
  config: KokpitConfig
): void {
  let layoutNode = document.get("layout", true);
  if (!isMap(layoutNode)) {
    document.set("layout", document.createNode({}));
    layoutNode = document.get("layout", true);
  }
  if (!isMap(layoutNode)) throw new Error("Unable to create fixed-grid layout mapping");
  for (const key of ["columns", "row_height", "tablet", "mobile"]) {
    layoutNode.delete(key);
  }
  if (config.layout.ungrouped === "first") layoutNode.set("ungrouped", "first");
  else layoutNode.delete("ungrouped");
  for (let index = 0; index < (config.groups?.length ?? 0); index += 1) {
    document.deleteIn(["groups", index, "columns"]);
  }
  for (const [index, tile] of config.service_tiles.entries()) {
    document.deleteIn(["service_tiles", index, "size"]);
    document.setIn(["service_tiles", index, "footprint"], tile.footprint);
  }
}

function waitForConfigLock(deadline: number): void {
  if (Date.now() >= deadline) {
    throw new Error(
      `Timed out waiting for settings lock ${CONFIG_PATH}.lock; ` +
      "if no Kokpit process is using this config, remove only that lock directory and restart"
    );
  }
  Atomics.wait(LOCK_WAIT_BUFFER, 0, 0, 10);
}

function acquireConfigLock(): () => void {
  const deadline = Date.now() + CONFIG_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      return lockSync(CONFIG_PATH, {
        realpath: false,
        // A synchronous writer cannot heartbeat safely. Fail closed instead of
        // racing another process to reclaim a lock that only appears stale.
        stale: Number.POSITIVE_INFINITY,
        update: 10_000,
      });
    } catch (error) {
      if (!hasErrorCode(error, "ELOCKED")) throw error;
      waitForConfigLock(deadline);
    }
  }
}

function withConfigLock<T>(operation: () => T): T {
  const release = acquireConfigLock();
  try {
    return operation();
  } finally {
    release();
  }
}

function recoverInterruptedInstall(): void {
  if (!existsSync(/* turbopackIgnore: true */ CONFIG_DISPLACED_PATH)) return;
  if (existsSync(/* turbopackIgnore: true */ CONFIG_PATH)) {
    renameSync(/* turbopackIgnore: true */ CONFIG_DISPLACED_PATH, `${CONFIG_DISPLACED_PATH}.recovered-${randomUUID()}`);
    return;
  }
  try {
    linkSync(/* turbopackIgnore: true */ CONFIG_DISPLACED_PATH, CONFIG_PATH);
    try { unlinkSync(/* turbopackIgnore: true */ CONFIG_DISPLACED_PATH); }
    catch (error) { console.error("[kokpit] could not remove recovered settings transaction:", error); }
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) throw error;
    renameSync(/* turbopackIgnore: true */ CONFIG_DISPLACED_PATH, `${CONFIG_DISPLACED_PATH}.conflict-${randomUUID()}`);
  }
}

function installConfigIfSourceUnchanged(source: string, temp: string): boolean {
  recoverInterruptedInstall();
  let installed = false;
  let primaryError: unknown;
  renameSync(/* turbopackIgnore: true */ CONFIG_PATH, CONFIG_DISPLACED_PATH);
  try {
    if (readFileSync(/* turbopackIgnore: true */ CONFIG_DISPLACED_PATH, "utf-8") !== source) return false;
    try {
      // A hard link is an atomic no-replace install. If an external editor
      // recreates settings.yaml while it is displaced, EEXIST preserves it.
      linkSync(/* turbopackIgnore: true */ temp, CONFIG_PATH);
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) return false;
      throw error;
    }
    installed = true;
    try { unlinkSync(/* turbopackIgnore: true */ temp); }
    catch (error) { console.error("[kokpit] could not remove installed settings temporary file:", error); }
    try { unlinkSync(/* turbopackIgnore: true */ CONFIG_DISPLACED_PATH); }
    catch (error) { console.error("[kokpit] could not remove completed settings transaction:", error); }
    return true;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (!installed && existsSync(/* turbopackIgnore: true */ CONFIG_DISPLACED_PATH)) {
      const reportOrThrowCleanupFailure = (message: string, error: unknown) => {
        if (primaryError !== undefined) {
          console.error(message, error);
          return;
        }
        throw error;
      };
      try {
        linkSync(/* turbopackIgnore: true */ CONFIG_DISPLACED_PATH, CONFIG_PATH);
        try { unlinkSync(/* turbopackIgnore: true */ CONFIG_DISPLACED_PATH); }
        catch (error) { console.error("[kokpit] could not remove restored settings transaction:", error); }
      } catch (error) {
        if (!hasErrorCode(error, "EEXIST")) {
          reportOrThrowCleanupFailure("[kokpit] could not restore settings transaction:", error);
        } else {
          try {
            renameSync(/* turbopackIgnore: true */ CONFIG_DISPLACED_PATH, `${CONFIG_DISPLACED_PATH}.conflict-${randomUUID()}`);
          } catch (cleanupError) {
            reportOrThrowCleanupFailure(
              "[kokpit] could not preserve conflicting settings transaction:",
              cleanupError
            );
          }
        }
      }
    }
  }
}

export function getConfigPath(): string { return CONFIG_PATH; }

function rewriteConfig(
  source: string,
  replacement: string,
  backupSuffix: ".v1.bak" | ".pre-v2.bak" | ".pre-fixed-grid.bak"
): boolean {
  if (readFileSync(/* turbopackIgnore: true */ CONFIG_PATH, "utf-8") !== source) return false;
  const temp = `${CONFIG_PATH}.tmp-${process.pid}-${randomUUID()}`;
  let backup = `${CONFIG_PATH}${backupSuffix}`;
  const sourceMode = statSync(/* turbopackIgnore: true */ CONFIG_PATH).mode & 0o777;
  try {
    while (true) {
      if (existsSync(/* turbopackIgnore: true */ backup)) {
        if (readFileSync(/* turbopackIgnore: true */ backup, "utf-8") === source) break;
        backup = `${CONFIG_PATH}${backupSuffix}.${randomUUID()}`;
        continue;
      }
      try {
        writeFileSync(/* turbopackIgnore: true */ backup, source, { encoding: "utf-8", flag: "wx", flush: true, mode: sourceMode });
        chmodSync(backup, sourceMode);
        break;
      } catch (error) {
        if (!hasErrorCode(error, "EEXIST")) throw error;
      }
    }
    writeFileSync(/* turbopackIgnore: true */ temp, replacement, { encoding: "utf-8", flush: true, mode: sourceMode });
    chmodSync(temp, sourceMode);
    if (!installConfigIfSourceUnchanged(source, temp)) {
      if (existsSync(/* turbopackIgnore: true */ temp)) unlinkSync(/* turbopackIgnore: true */ temp);
      return false;
    }
    return true;
  }
  catch (error) {
    try { if (existsSync(/* turbopackIgnore: true */ temp)) renameSync(/* turbopackIgnore: true */ temp, `${temp}.failed`); } catch {}
    throw new Error(`Unable to atomically rewrite ${CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

type LoadConfigAttempt = {
  state: "ready" | "migration-required";
  config: KokpitConfig;
  source: string;
};

function migrationResult(
  config: KokpitConfig,
  source: string,
  replacement: string,
  backupSuffix: ".v1.bak" | ".pre-v2.bak" | ".pre-fixed-grid.bak",
  allowRewrite: boolean
): LoadConfigAttempt | null {
  if (!allowRewrite) return { state: "migration-required", config, source };
  if (!rewriteConfig(source, replacement, backupSuffix)) return null;
  return { state: "ready", config, source: replacement };
}

function loadConfigAttempt(source = readFileSync(/* turbopackIgnore: true */ CONFIG_PATH, "utf-8"), allowRewrite = true): LoadConfigAttempt | null {
  const document = parseSettingsDocument(source);
  const parsed = source.trim() === "" ? {} : document.toJS() as unknown;
  if (!isRecord(parsed)) throw new Error("Invalid settings.yaml:\n  • settings: expected an object");
  const hasVersion = "schema_version" in parsed;
  const version = parsed.schema_version;
  const shape = classifyConfigShape(parsed);
  let config: KokpitConfig;
  if (hasVersion && version === 1) {
    if (shape === "v2" || shape === "mixed") {
      throw new Error("Invalid settings.yaml:\n  • schema_version: Version 1 contradicts the detected schema v2 shape");
    }
    try { config = migrateFixedGridConfig(migrateV1Config(parsed as Record<string, unknown>) as unknown as Record<string, unknown>); }
    catch (error) { throw new Error(`Unable to migrate ${CONFIG_PATH} from schema v1: ${error instanceof Error ? error.message : String(error)}`); }
    document.set("schema_version", 2);
    setMigratedServiceNodes(document, config);
    setFixedGridNodes(document, config);
    const replacement = document.toString();
    return migrationResult(config, source, replacement, ".v1.bak", allowRewrite);
  } else if (hasVersion && version === 2) {
    if (shape === "legacy" || shape === "mixed") {
      throw new Error("Invalid settings.yaml:\n  • schema_version: Version 2 contradicts the detected legacy shape");
    }
    if (needsFixedGridMigration(parsed)) {
      config = migrateFixedGridConfig(parsed);
      setFixedGridNodes(document, config);
      const replacement = document.toString();
      return migrationResult(config, source, replacement, ".pre-fixed-grid.bak", allowRewrite);
    }
    const result = KokpitConfigSchema.safeParse(parsed);
    if (!result.success) throw new Error(`Invalid settings.yaml:\n${validationError(result.error)}`);
    config = result.data;
  } else if (hasVersion) {
    throw new Error(`Invalid settings.yaml:\n  • schema_version: Unsupported version ${String(version)} (expected 1 for migration or 2)`);
  } else {
    if (shape === "mixed") throw new Error("Invalid settings.yaml:\n  • services: Ambiguous mixed legacy and schema v2 service shapes");
    try {
      config = shape === "legacy"
        ? migrateV1Config(parsed)
        : KokpitConfigSchema.parse({ ...parsed, schema_version: 2 });
      config = migrateFixedGridConfig(config as unknown as Record<string, unknown>);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(shape === "legacy"
        ? `Unable to migrate ${CONFIG_PATH} from unversioned legacy settings: ${message}`
        : `Invalid settings.yaml:\n${message}`);
    }
    document.set("schema_version", 2);
    if (shape === "legacy") {
      setMigratedServiceNodes(document, config);
    }
    setFixedGridNodes(document, config);
    const replacement = document.toString();
    return migrationResult(config, source, replacement, ".pre-v2.bak", allowRewrite);
  }
  return { state: "ready", config, source };
}

export function loadConfig(): KokpitConfig {
  // Server components are evaluated during `next build`. Use defaults for
  // that render without creating or migrating runtime-owned files.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return KokpitConfigSchema.parse({ schema_version: 2 });
  }
  const existing = configCache();
  // Loading can migrate a legacy document on disk. That side effect is only
  // allowed during bootstrap; a watcher-observed transition must stay purely
  // in memory until an operator deliberately restarts with that source.
  if (existing.state !== "cold") {
    if (existing.state === "dirty" || !existing.config) throw new ConfigUnavailableError();
    return existing.config;
  }
  mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  return withConfigLock(() => {
    recoverInterruptedInstall();
    if (!existsSync(/* turbopackIgnore: true */ CONFIG_PATH)) {
      writeFileSync(/* turbopackIgnore: true */ CONFIG_PATH, DEFAULT_CONFIG, { encoding: "utf-8", flush: true, mode: 0o600 });
      try { chmodSync(CONFIG_PATH, 0o600); } catch { /* creation mode is already restrictive */ }
    }
    for (let attempt = 0; attempt < CONFIG_REWRITE_ATTEMPTS; attempt += 1) {
      const result = loadConfigAttempt();
      if (result) {
        const cache = configCache();
        cache.config = result.config;
        cache.source = result.source;
        cache.pendingSource = null;
        cache.state = result.state;
        return result.config;
      }
    }
    throw new Error(`Unable to load ${CONFIG_PATH}: settings changed repeatedly during migration`);
  });
}

export function getConfig(): KokpitConfig {
  const cache = configCache();
  if (cache.state === "cold") return loadConfig();
  verifyConfirmedSource(cache);
  if (cache.state === "dirty") throw new ConfigUnavailableError();
  if (!cache.config) throw new ConfigUnavailableError();
  return cache.config;
}

export function getConfigSnapshot(): ConfigSnapshot {
  const cache = configCache();
  if (cache.state === "cold") loadConfig();
  const current = configCache();
  verifyConfirmedSource(current);
  return { state: current.state, config: current.config, source: current.source };
}

/** Marks the cache dirty if a caller observes disk bytes different from the
 * last source that was fully parsed and published. */
function verifyConfirmedSource(cache: ConfigCache): void {
  if (cache.state !== "ready" && cache.state !== "migration-required") return;
  try {
    const observedSource = readFileSync(/* turbopackIgnore: true */ CONFIG_PATH, "utf-8");
    if (observedSource !== cache.source) {
      cache.pendingSource = observedSource;
      cache.state = "dirty";
      scheduleCacheRefresh(cache);
    }
  } catch {
    cache.pendingSource = null;
    cache.state = "dirty";
    scheduleCacheRefresh(cache);
  }
}

function scheduleCacheRefresh(cache = configCache()): void {
  if (cache.refreshTimer) return;
  const delay = cache.refreshRetryDelayMs;
  cache.refreshRetryDelayMs = Math.min(cache.refreshRetryDelayMs * 2, 5_000);
  cache.refreshTimer = setTimeout(() => {
    cache.refreshTimer = null;
    if (refreshConfigCache() === "dirty") scheduleCacheRefresh(cache);
  }, delay);
  cache.refreshTimer.unref();
}

function resetCacheRefresh(cache: ConfigCache): void {
  if (cache.refreshTimer) clearTimeout(cache.refreshTimer);
  cache.refreshTimer = null;
  cache.refreshRetryDelayMs = 100;
}

/**
 * Marks an external config edit synchronously. The source is sampled now and
 * must be unchanged when the debounce refresh runs before it can be trusted.
 */
export function markConfigDirty(): boolean {
  const cache = configCache();
  try {
    const source = readFileSync(/* turbopackIgnore: true */ CONFIG_PATH, "utf-8");
    // Our atomic write has already published these exact bytes. fs.watch may
    // report that write after publication; it is not an external transition.
    if (
      (cache.state === "ready" || cache.state === "migration-required")
      && cache.source === source
    ) return false;
    cache.pendingSource = source;
  } catch {
    cache.pendingSource = null;
  }
  cache.state = "dirty";
  scheduleCacheRefresh(cache);
  return true;
}

/** Returns a ready snapshot only when disk still exactly matches the cache. */
export function getConfigSnapshotForWrite(): ConfigSnapshot {
  const cache = configCache();
  if (cache.state === "cold") loadConfig();
  const current = configCache();
  verifyConfirmedSource(current);
  if (current.state !== "ready") {
    return { state: current.state, config: current.config, source: current.source };
  }
  const stable = configCache();
  return { state: stable.state, config: stable.config, source: stable.source };
}

/**
 * Updates the process-wide cache after a filesystem event without mutating a
 * concurrently edited settings file. Invalid, transient, or migration-needed
 * input keeps the last known-good configuration retained internally while
 * reads fail closed until a stable source can be published.
 */
export function refreshConfigCache(): ConfigCacheState {
  const cache = configCache();
  try {
    const source = readFileSync(/* turbopackIgnore: true */ CONFIG_PATH, "utf-8");
    if (!source.trim()) {
      cache.state = "dirty";
      cache.pendingSource = source;
      return cache.state;
    }
    if (
      cache.pendingSource === null
      && cache.source === source
      && cache.config
      && (cache.state === "ready" || cache.state === "migration-required")
    ) {
      return cache.state;
    }
    // The first observation is deliberately only a candidate. This prevents
    // an API PATCH from accepting a partially replaced file as writable.
    if (cache.pendingSource !== source) {
      cache.pendingSource = source;
      cache.state = "dirty";
      return cache.state;
    }
    const result = loadConfigAttempt(source, false);
    if (!result) {
      cache.state = "dirty";
      return cache.state;
    }
    cache.config = result.config;
    cache.source = result.source;
    cache.pendingSource = null;
    cache.state = result.state;
    resetCacheRefresh(cache);
    return cache.state;
  } catch {
    cache.state = "dirty";
    return cache.state;
  }
}
export class ConfigRevisionMismatchError extends Error {
  constructor(readonly currentRevision?: string) {
    super("settings.yaml changed before it could be written");
    this.name = "ConfigRevisionMismatchError";
  }
}

function revisionMismatchForCurrentConfig(): ConfigRevisionMismatchError {
  try {
    const latestSource = readFileSync(/* turbopackIgnore: true */ CONFIG_PATH, "utf-8");
    const latestDocument = parseSettingsDocument(latestSource);
    const latestConfig = KokpitConfigSchema.parse(latestDocument.toJS());
    markConfigDirty();
    return new ConfigRevisionMismatchError(configRevision(latestConfig));
  } catch {
    return new ConfigRevisionMismatchError();
  }
}

export function writeConfig(
  updates: Partial<KokpitConfig>,
  expectedRevision?: string,
  expectedSource?: string
): KokpitConfig {
  let persistedConfig: KokpitConfig;
  let persistedSource: string;
  const fixedGridUpdates: Partial<KokpitConfig> = { ...updates };
  if (updates.layout) {
    fixedGridUpdates.layout = (updates.layout.ungrouped === "first"
      ? { ungrouped: "first" }
      : {}) as KokpitConfig["layout"];
  }
  if (updates.service_tiles) {
    fixedGridUpdates.service_tiles = migrateFixedGridConfig({
      schema_version: 2,
      services: updates.services ?? getConfig().services,
      service_tiles: updates.service_tiles,
    }).service_tiles;
  }
  withConfigLock(() => {
    const source = readFileSync(/* turbopackIgnore: true */ CONFIG_PATH, "utf-8");
    // An API request may only write the exact bytes it just authorized. A
    // matching semantic revision is insufficient: comments and a freshly
    // introduced auth policy are still an external ownership transition.
    if (expectedRevision !== undefined && (expectedSource ?? configCache().source) !== source) {
      throw revisionMismatchForCurrentConfig();
    }
    const doc = parseSettingsDocument(source);
    const current = KokpitConfigSchema.parse(doc.toJS());
    const currentRevision = configRevision(current);
    if (expectedRevision !== undefined && currentRevision !== expectedRevision) {
      throw new ConfigRevisionMismatchError(currentRevision);
    }
    KokpitConfigSchema.parse({ ...current, ...fixedGridUpdates });
    const temp = `${CONFIG_PATH}.tmp-${process.pid}-${randomUUID()}`;
    for (const [key, value] of Object.entries(fixedGridUpdates)) doc.setIn([key], value);
    // Parse the exact document that will be persisted, not just the in-memory merge.
    persistedConfig = KokpitConfigSchema.parse(doc.toJS());
    persistedSource = doc.toString();
    let mode = 0o600;
    try {
      if (existsSync(/* turbopackIgnore: true */ CONFIG_PATH)) mode = statSync(/* turbopackIgnore: true */ CONFIG_PATH).mode & 0o777;
    } catch {
      // Test doubles and unusual filesystems may not expose mode metadata.
    }
    try {
      writeFileSync(/* turbopackIgnore: true */ temp, persistedSource, { encoding: "utf-8", flush: true, mode });
      try { chmodSync(temp, mode); } catch { /* write mode is already restrictive */ }
      if (!installConfigIfSourceUnchanged(source, temp)) throw revisionMismatchForCurrentConfig();
    } catch (error) {
      try { if (existsSync(/* turbopackIgnore: true */ temp)) renameSync(/* turbopackIgnore: true */ temp, `${temp}.failed`); } catch {}
      throw error;
    }
  });
  const cache = configCache();
  cache.config = persistedConfig!;
  cache.source = persistedSource!;
  cache.pendingSource = null;
  cache.state = "ready";
  resetCacheRefresh(cache);
  return persistedConfig!;
}
export function invalidateCache(): void {
  const cache = configCache();
  resetCacheRefresh(cache);
  cache.config = null;
  cache.source = null;
  cache.pendingSource = null;
  cache.state = "cold";
}
