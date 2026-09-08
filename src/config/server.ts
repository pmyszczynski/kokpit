/**
 * Server-only configuration I/O.
 *
 * Keep this separate from the shared config barrel: loader.ts uses Node-only
 * locking primitives and must never be included in a client component bundle.
 */
export {
  getConfig,
  getConfigSnapshot,
  getConfigSnapshotForWrite,
  loadConfig,
  writeConfig,
  getConfigPath,
  refreshConfigCache,
  markConfigDirty,
  invalidateCache,
  legacyIntegrationType,
  splitLegacyWidgetConfig,
  ConfigRevisionMismatchError,
  ConfigUnavailableError,
} from "./loader";
