import { z } from "zod";

/**
 * @deprecated Legacy absolute-position field. Kept parseable so existing
 * configs keep loading; new configs should use `services[].size` + array
 * order instead. Will be removed at the next `schema_version` bump.
 */
export const WidgetPositionSchema = z.object({
  col: z.number().int().positive(),
  row: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/**
 * Named tile size presets (col×row spans in the dashboard grid):
 * normal = 1×1, wide = 2×1, tall = 1×2, large = 2×2.
 */
export const SizeEnum = z.enum(["normal", "wide", "tall", "large"]);
export type Size = z.infer<typeof SizeEnum>;

// Inline widget attached to a service tile (type + API credentials + optional field filter).
// Position lives on the parent ServiceSchema, not here.
export const ServiceTileWidgetSchema = z.object({
  type: z.string(),
  config: z.record(z.string(), z.unknown()).optional(),
  fields: z.array(z.string()).optional(),
  refresh_interval_ms: z.number().int().min(5000).optional(),
});

export const IntegrationSchema = z.object({
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const ServiceSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1),
  launch_url: z.url().optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  integration: IntegrationSchema.optional(),
});

export const ServiceTileSchema = z.object({
  id: z.uuid(),
  service_id: z.uuid(),
  group: z.string().optional(),
  size: SizeEnum.optional(),
  widget: ServiceTileWidgetSchema.optional(),
});

/** Persisted compatibility invariant used before the runtime registry loads. */
export function widgetIntegrationRequirement(type: string): string | null {
  if (type === "system-stats") return null;
  if (type.startsWith("actualbudget-")) return "actualbudget";
  if (type.startsWith("qbittorrent-")) return "qbittorrent";
  if (type.startsWith("netdata-")) return "netdata";
  const known: Record<string, string> = {
    "immich-stats": "immich", "prowlarr-stats": "prowlarr",
    "radarr-queue": "radarr", "radarr-stats": "radarr",
    "seerr-requests": "seerr", "seerr-stats": "seerr",
    "sonarr-calendar": "sonarr", "sonarr-queue": "sonarr",
    "tautulli-activity": "tautulli", "tdarr-stats": "tdarr",
    "unraid-stats": "unraid",
  };
  return known[type] ?? type;
}

/** Declared dashboard group. Array order in `groups:` is display order. */
export const GroupSchema = z.object({
  name: z.string(),
  /** Default collapsed state; live state is persisted per-browser. */
  collapsed: z.boolean().optional(),
  /** Per-group column override. */
  columns: z.number().int().positive().optional(),
});

export const BookmarkLinkSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  icon: z.string().optional(),
  /** Homepage-style fallback shown when there is no icon (max 2 chars). */
  abbr: z.string().max(2).optional(),
  /** Optional muted second line; rendered only in `list` style. */
  description: z.string().optional(),
});

export const BookmarkGroupSchema = z.object({
  name: z.string(),
  /** CSS color used for the group header + link markers. */
  accent: z.string().min(1).optional(),
  // Intentionally no schema default (resolve-time default is "list") so
  // omitted values stay omitted in YAML round-trips.
  style: z.enum(["list", "icon-grid", "compact"]).optional(),
  /** Where the bookmark tile lives in the grid. */
  placement: z
    .object({
      group: z.string().optional(),
      size: SizeEnum.optional(),
    })
    .optional(),
  links: z.array(BookmarkLinkSchema),
});

/**
 * Dashboard background. All keys optional. `color`/`gradient`/`image` are the
 * paint source and are last-wins if more than one is set (see resolveBackgroundVars
 * in ./theme: image beats gradient beats color, matching this key order). `blur`
 * and `brightness` filter the paint layer; `opacity` drives a separate theme-tinted
 * overlay on top of it.
 */
export const BackgroundSchema = z.object({
  /** Solid background color (any CSS color). */
  color: z.string().min(1).optional(),
  /** CSS gradient value, e.g. "linear-gradient(...)". */
  gradient: z.string().min(1).optional(),
  /** Image URL or uploaded `/api/backgrounds/user/...` path. */
  image: z.string().min(1).optional(),
  /** Blur-behind radius in px. */
  blur: z.number().min(0).max(100).optional(),
  /** Brightness multiplier 0–1 (dims the image). */
  brightness: z.number().min(0).max(1).optional(),
  /** Theme-tinted overlay opacity 0–1 on top of the background. */
  opacity: z.number().min(0).max(1).optional(),
});

/** Normalized key for comparing service names (trim + lowercase). */
export function serviceNameUniquenessKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Case-insensitive unique-name refinement shared by groups and bookmarks. */
function uniqueNamesRefinement(kind: string) {
  return (items: Array<{ name: string }>, ctx: z.RefinementCtx): void => {
    const seen = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      const key = serviceNameUniquenessKey(items[i].name);
      if (key === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${kind} name cannot be empty or whitespace only`,
          path: [i, "name"],
        });
        continue;
      }
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate ${kind.toLowerCase()} name "${items[i].name.trim()}"`,
          path: [i, "name"],
        });
      } else {
        seen.add(key);
      }
    }
  };
}

/** Ordered group declarations with case-insensitive unique names. */
export const GroupsSchema = z
  .array(GroupSchema)
  .superRefine(uniqueNamesRefinement("Group"));

/** Bookmark groups with case-insensitive unique names. */
export const BookmarkGroupsSchema = z
  .array(BookmarkGroupSchema)
  .superRefine(uniqueNamesRefinement("Bookmark group"));

export const KokpitConfigSchema = z
  .object({
    schema_version: z.literal(2),
    auth: z
      .object({
        enabled: z.boolean().default(false),
        session_ttl_hours: z.number().int().positive().default(24),
      })
      .default({ enabled: true, session_ttl_hours: 24 }),
    appearance: z
      .object({
        theme: z
          .enum(["dark", "light", "oled", "high-contrast"])
          .default("dark"),
        custom_css: z.string().optional(),
        // Frosted-glass backdrop-filter radius on cards (px). Omitted/0 keeps
        // cards fully opaque (no default appearance change); >0 opts in to
        // translucency. See resolveBackgroundVars in ./theme.
        card_blur: z.number().min(0).max(40).optional(),
        background: BackgroundSchema.optional(),
      })
      .default({ theme: "dark" }),
    layout: z
      .object({
        columns: z.number().int().positive().default(4),
        row_height: z.number().int().positive().default(120),
        // Placement of the implicit "ungrouped" section. No schema default:
        // resolveGroupOrder applies the "last" default so omitted values stay
        // omitted in YAML round-trips.
        ungrouped: z.enum(["first", "last"]).optional(),
        tablet: z
          .object({
            columns: z.number().int().positive().optional(),
            row_height: z.number().int().positive().optional(),
          })
          .optional(),
        mobile: z
          .object({
            columns: z.number().int().positive().optional(),
            row_height: z.number().int().positive().optional(),
          })
          .optional(),
      })
      .default({ columns: 4, row_height: 120 }),
    // Ordered group declarations — array order is display order. Groups
    // referenced by services but not declared here are auto-appended at
    // render time (see resolveGroupOrder in ./resolve).
    groups: GroupsSchema.optional(),
    services: z.array(ServiceSchema).default([]),
    service_tiles: z.array(ServiceTileSchema).default([]),
    bookmarks: BookmarkGroupsSchema.optional(),
  })
  .catchall(z.unknown())
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < data.services.length; i++) {
      const svc = data.services[i];
      if (seen.has(svc.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate Service ID "${svc.id}"`,
          path: ["services", i, "id"],
        });
      } else {
        seen.add(svc.id);
      }
    }
    const tileIds = new Set<string>();
    for (let i = 0; i < data.service_tiles.length; i++) {
      const tile = data.service_tiles[i];
      if (tileIds.has(tile.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate ServiceTile ID "${tile.id}"`, path: ["service_tiles", i, "id"] });
      tileIds.add(tile.id);
      if (!seen.has(tile.service_id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `ServiceTile references missing Service "${tile.service_id}"`, path: ["service_tiles", i, "service_id"] });
      const service = data.services.find((candidate) => candidate.id === tile.service_id);
      if (tile.widget && service) {
        const required = widgetIntegrationRequirement(tile.widget.type);
        if (required !== null && service.integration?.type !== required) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Widget "${tile.widget.type}" requires integration "${required}"`, path: ["service_tiles", i, "service_id"] });
        for (const key of Object.keys(tile.widget.config ?? {})) {
          if (Object.prototype.hasOwnProperty.call(service.integration?.config ?? {}, key)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Tile option "${key}" conflicts with Service integration configuration`, path: ["service_tiles", i, "widget", "config", key] });
          }
        }
      }
    }
  });

export type KokpitConfig = z.infer<typeof KokpitConfigSchema>;
/**
 * Editor input accepted by legacy component call-sites while the UI migration
 * is in progress. Persisted Services are always validated by ServiceSchema;
 * the optional legacy presentation keys are never part of that schema.
 */
export type Service = Partial<z.infer<typeof ServiceSchema>> &
  Pick<z.infer<typeof ServiceSchema>, "name"> & {
    url?: string;
    group?: string;
    size?: Size;
    position?: WidgetPosition;
    widget?: ServiceWidget;
  };
export type ServiceTile = z.infer<typeof ServiceTileSchema>;
export type ServiceWidget = z.infer<typeof ServiceTileWidgetSchema>;
/** @deprecated See WidgetPositionSchema. */
export type WidgetPosition = z.infer<typeof WidgetPositionSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type Background = z.infer<typeof BackgroundSchema>;
export type BookmarkGroup = z.infer<typeof BookmarkGroupSchema>;
export type BookmarkLink = z.infer<typeof BookmarkLinkSchema>;
