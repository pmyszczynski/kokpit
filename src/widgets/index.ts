import type React from "react";
import type { z } from "zod";
import type { Size } from "@/config/schema";

export interface WidgetProps<TData = unknown> {
  data: TData | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

export type WidgetConfigFieldType =
  | "text"
  | "url"
  | "password"
  | "number"
  | "multiselect"
  | "boolean";

export interface WidgetConfigField {
  key: string;
  label: string;
  type: WidgetConfigFieldType;
  placeholder?: string;
  description?: string;
  required?: boolean;
  /** Options for multiselect fields. */
  options?: Array<{ value: string; label: string }>;
  /**
   * For boolean fields: the effective value to show when this key is absent
   * from the saved config. Must match the zod schema's `.default()` for the
   * same key — a config written before the field was exposed has no entry, but
   * the widget still behaves as the schema default says, and an unchecked box
   * over a `true` default would misreport live behaviour.
   */
  defaultValue?: boolean;
}

/** Default tile label and icon when picking this widget in the service editor. */
export interface ServiceEditorPreset {
  defaultName: string;
  defaultIconUrl: string;
}

export interface WidgetDefinition<TConfig = Record<string, unknown>, TData = unknown> {
  id: string;
  name: string;
  configSchema: z.ZodType<TConfig>;
  /** fetchData receives an AbortSignal so the caller can cancel a timed-out request. */
  fetchData: (config: TConfig, signal?: AbortSignal) => Promise<TData>;
  /** Refresh interval in milliseconds. Defaults to 30_000. */
  refreshInterval?: number;
  component: React.ComponentType<WidgetProps<TData>>;
  /** Describes the config fields for in-app UI rendering. */
  configFields?: WidgetConfigField[];
  /** When set, this widget appears as a tile type in the service editor. */
  serviceEditorPreset?: ServiceEditorPreset;
  /**
   * Suggested tile size when a service attaches this widget and sets no
   * explicit `size`. Consumed by resolveServiceSize (src/config/resolve.ts).
   */
  preferredSize?: Size;
  /** Smallest size the widget renders usefully at; the size picker greys out anything below. */
  minSize?: Size;
  /**
   * Overrides the default 5s widget fetch timeout (WIDGET_FETCH_TIMEOUT_MS
   * in src/lib/fetchTimeout.ts) for this widget's fetchData calls. Leave
   * unset to use the default.
   */
  fetchTimeoutMs?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyWidgetDefinition = WidgetDefinition<any, any>;

const widgetRegistry = new Map<string, AnyWidgetDefinition>();

export function registerWidget<TConfig = Record<string, unknown>, TData = unknown>(
  def: WidgetDefinition<TConfig, TData>
): void {
  if (widgetRegistry.has(def.id)) {
    throw new Error(`Widget "${def.id}" is already registered`);
  }
  widgetRegistry.set(def.id, def as AnyWidgetDefinition);
}

export function getWidget<TConfig = Record<string, unknown>, TData = unknown>(
  id: string
): WidgetDefinition<TConfig, TData> | undefined {
  return widgetRegistry.get(id) as WidgetDefinition<TConfig, TData> | undefined;
}

export function getAllWidgets(): AnyWidgetDefinition[] {
  return Array.from(widgetRegistry.values());
}

/** Widgets exposed as integration tile types in the service editor (sorted by name). */
export function getWidgetsWithServiceEditorPreset(): AnyWidgetDefinition[] {
  return getAllWidgets()
    .filter((w) => w.serviceEditorPreset != null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Size hints of a registered widget, safe to pass to client components. */
export interface WidgetSizeHints {
  preferredSize?: Size;
  minSize?: Size;
}

/**
 * Looks up a widget's size hints by type id. Server-safe: contains no client
 * code, so the server-rendered grid can call it directly — callers must have
 * populated the registry first (`import "@/integrations"`). Returns undefined
 * for unknown widget types.
 */
export function getWidgetSizeHints(id: string): WidgetSizeHints | undefined {
  const def = widgetRegistry.get(id);
  if (!def) return undefined;
  return { preferredSize: def.preferredSize, minSize: def.minSize };
}

/** Removes all registered widgets. Intended for use in tests only. */
export function clearRegistry(): void {
  widgetRegistry.clear();
}
