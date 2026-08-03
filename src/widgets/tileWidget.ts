// Shared server/client boundary for a service's widget: what the tile is
// allowed to know about `service.widget`. Lives here (not in a component) so
// the server grid (ServiceGrid) and the edit-mode grid (EditableServiceGrid)
// derive it identically from one implementation.
import type { ServiceWidget } from "@/config/schema";
import {
  getWidget,
  type AnyWidgetDefinition,
  type WidgetConfigField,
} from "@/widgets";
import { isWidgetSecretReference } from "@/widgets/secretReference";

/** One Zod issue, reduced to the two fields that are safe to send to a tile. */
export interface WidgetConfigIssue {
  /** Dotted config path, e.g. `"api_key"`. `"config"` for a root-level issue. */
  path: string;
  message: string;
}

// Client-safe slice of ServiceWidget: the config (credentials) stays on the
// server — the widget data API looks it up in settings.yaml by service name.
export interface TileWidget {
  type: string;
  refresh_interval_ms?: number;
  /** Set when the widget type is KNOWN but its config fails the widget's schema. */
  invalid?: WidgetConfigIssue[];
}

interface ResolveTileWidgetOptions {
  /** Browser edit previews receive signed credential references, not secrets. */
  normalizeSecretReferences?: boolean;
}

/** Path label used when a Zod issue has no path (whole-object failure). */
const ROOT_ISSUE_PATH = "config";

/**
 * Replaces browser-safe references for saved password fields with a harmless
 * value before client-side schema validation. The server still verifies the
 * signed reference before accepting a save; this only lets the editor render
 * an already-configured widget without exposing its credential.
 */
export function widgetConfigForValidation(
  fields: WidgetConfigField[] | undefined,
  config: Record<string, unknown>
): Record<string, unknown> {
  if (!fields) return config;
  const validationConfig = { ...config };
  for (const field of fields) {
    if (
      field.type === "password" &&
      isWidgetSecretReference(validationConfig[field.key])
    ) {
      validationConfig[field.key] = "saved-credential";
    }
  }
  return validationConfig;
}

/**
 * Validation issues for `config` against a widget's own `configSchema`, in a
 * form that is safe to hand to a client component.
 *
 * SECURITY: map ONLY `path` and `message`. Never spread the Zod issue and
 * never include `input` / `received` / `values` — Zod 4 issues can carry the
 * offending input value, and widget configs hold credentials (API keys,
 * tokens). Config values must never leave the server; that is the entire
 * reason TileWidget is a slice of ServiceWidget rather than the whole thing.
 */
export function widgetConfigIssues(
  def: AnyWidgetDefinition,
  config: unknown
): WidgetConfigIssue[] {
  const result = def.configSchema.safeParse(config ?? {});
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path.join(".") || ROOT_ISSUE_PATH,
    message: issue.message,
  }));
}

// Decide what the client tile gets to see of a service's widget:
// - no widget → nothing
// - unknown type → sanitized pass-through, so the renderer surfaces the typo
// - known type with valid config → sanitized widget
// - known type with missing/invalid config → sanitized widget + the schema
//   issues, so the tile can show a warning badge instead of silently
//   downgrading to a plain link
// Config (credentials) never leaves the server either way.
export function resolveTileWidget(
  widget?: ServiceWidget,
  connection?: Record<string, unknown>,
  options?: ResolveTileWidgetOptions
): TileWidget | undefined {
  if (!widget) return undefined;
  const def = getWidget(widget.type);
  const issues = def
    ? widgetConfigIssues(
        def,
        options?.normalizeSecretReferences
          ? widgetConfigForValidation(def.configFields, {
              ...(connection ?? {}),
              ...(widget.config ?? {}),
            })
          : { ...(connection ?? {}), ...(widget.config ?? {}) }
      )
    : [];
  return {
    type: widget.type,
    refresh_interval_ms: widget.refresh_interval_ms,
    ...(issues.length > 0 ? { invalid: issues } : {}),
  };
}
