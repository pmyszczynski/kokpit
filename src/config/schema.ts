import { z } from "zod";

const ServiceSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  icon: z.string().optional(),
  description: z.string().optional(),
  group: z.string().optional(),
});

const WidgetPositionSchema = z.object({
  col: z.number().int().positive(),
  row: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const WidgetSchema = z.object({
  type: z.string(),
  config: z.record(z.string(), z.unknown()).optional(),
  position: WidgetPositionSchema.optional(),
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
    })
    .default({ columns: 4, row_height: 120 }),
  services: z.array(ServiceSchema).default([]),
  widgets: z.array(WidgetSchema).default([]),
});

export type KokpitConfig = z.infer<typeof KokpitConfigSchema>;
export type Service = z.infer<typeof ServiceSchema>;
export type Widget = z.infer<typeof WidgetSchema>;
