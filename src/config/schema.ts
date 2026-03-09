import { z } from "zod";

export const WidgetPositionSchema = z.object({
  col: z.number().int().positive(),
  row: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

// Inline widget attached to a service tile (type + API credentials + optional field filter).
// Position lives on the parent ServiceSchema, not here.
const ServiceWidgetSchema = z.object({
  type: z.string(),
  config: z.record(z.string(), z.unknown()).optional(),
  fields: z.array(z.string()).optional(),
});

const ServiceSchema = z.object({
  name: z.string(),
  url: z.string().url().optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
  group: z.string().optional(),
  position: WidgetPositionSchema.optional(),
  widget: ServiceWidgetSchema.optional(),
});

export const KokpitConfigSchema = z.object({
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
  services: z.array(ServiceSchema).default([]),
});

export type KokpitConfig = z.infer<typeof KokpitConfigSchema>;
export type Service = z.infer<typeof ServiceSchema>;
export type ServiceWidget = z.infer<typeof ServiceWidgetSchema>;
export type WidgetPosition = z.infer<typeof WidgetPositionSchema>;
