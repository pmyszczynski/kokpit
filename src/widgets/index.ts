import type React from "react";
import type { z } from "zod";

export interface WidgetProps<TData = unknown> {
  data: TData | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
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
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWidgetDefinition = WidgetDefinition<any, any>;

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

/** Removes all registered widgets. Intended for use in tests only. */
export function clearRegistry(): void {
  widgetRegistry.clear();
}
