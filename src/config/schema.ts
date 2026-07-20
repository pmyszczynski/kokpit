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
const ServiceWidgetSchema = z.object({
  type: z.string(),
  config: z.record(z.string(), z.unknown()).optional(),
  fields: z.array(z.string()).optional(),
  refresh_interval_ms: z.number().int().min(5000).optional(),
});

const ServiceSchema = z.object({
  name: z.string(),
  url: z.string().url().optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
  group: z.string().optional(),
  // Tile size preset. Intentionally no schema default: the effective size is
  // computed at resolve time (see resolveServiceSize in ./resolve) so omitted
  // values stay omitted in YAML round-trips.
  size: SizeEnum.optional(),
  /** @deprecated Use `size` + array order; see WidgetPositionSchema. */
  position: WidgetPositionSchema.optional(),
  widget: ServiceWidgetSchema.optional(),
});

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
    schema_version: z.literal(1),
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
    bookmarks: BookmarkGroupsSchema.optional(),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < data.services.length; i++) {
      const svc = data.services[i];
      const key = serviceNameUniquenessKey(svc.name);
      if (key === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Service name cannot be empty or whitespace only",
          path: ["services", i, "name"],
        });
        continue;
      }
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate service name "${svc.name.trim()}"`,
          path: ["services", i, "name"],
        });
      } else {
        seen.add(key);
      }
    }
  });

export type KokpitConfig = z.infer<typeof KokpitConfigSchema>;
export type Service = z.infer<typeof ServiceSchema>;
export type ServiceWidget = z.infer<typeof ServiceWidgetSchema>;
/** @deprecated See WidgetPositionSchema. */
export type WidgetPosition = z.infer<typeof WidgetPositionSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type BookmarkGroup = z.infer<typeof BookmarkGroupSchema>;
export type BookmarkLink = z.infer<typeof BookmarkLinkSchema>;
