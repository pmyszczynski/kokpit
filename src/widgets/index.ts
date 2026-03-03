// Widget plugin system — Phase 2 (Widget system architecture task).
// Responsibilities:
//   - Define WidgetDefinition interface (config schema + async fetcher + render component)
//   - Widget registry
//   - Per-widget error and loading states
//   - Configurable refresh intervals
//
// DO NOT use this placeholder directly. It will be replaced in Phase 2.

export type WidgetDefinition = {
  id: string;
  name: string;
  // Full definition added in Phase 2
};

export const widgetRegistry: Map<string, WidgetDefinition> = new Map();
