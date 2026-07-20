import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isRequestAuthenticated } from "@/auth";
import { getConfig, writeConfig } from "@/config";
import { BookmarkGroupsSchema, GroupsSchema, SizeEnum } from "@/config/schema";

const PatchBodySchema = z.object({
  appearance: z
    .object({
      theme: z.enum(["dark", "light", "oled", "high-contrast"]),
      custom_css: z.string().optional(),
    })
    .optional(),
  layout: z
    .object({
      columns: z.number().int().positive(),
      row_height: z.number().int().positive(),
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
    .optional(),
  auth: z
    .object({
      enabled: z.boolean(),
      session_ttl_hours: z.number().int().positive(),
    })
    .optional(),
  services: z
    .array(
      z.object({
        name: z.string(),
        url: z.string().url().optional(),
        icon: z.string().optional(),
        description: z.string().optional(),
        group: z.string().optional(),
        size: SizeEnum.optional(),
        widget: z
          .object({
            type: z.string(),
            config: z.record(z.string(), z.unknown()).optional(),
            fields: z.array(z.string()).optional(),
            refresh_interval_ms: z.number().int().min(5000).optional(),
          })
          .optional(),
      })
    )
    .optional(),
  groups: GroupsSchema.optional(),
  bookmarks: BookmarkGroupsSchema.optional(),
});

export async function GET() {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = getConfig();
  return NextResponse.json(config);
}

export async function PATCH(request: NextRequest) {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = PatchBodySchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: result.error.message }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (result.data.appearance !== undefined)
    updates.appearance = result.data.appearance;
  if (result.data.layout !== undefined) updates.layout = result.data.layout;
  if (result.data.auth !== undefined) updates.auth = result.data.auth;
  if (result.data.services !== undefined)
    updates.services = result.data.services;
  if (result.data.groups !== undefined) updates.groups = result.data.groups;
  if (result.data.bookmarks !== undefined)
    updates.bookmarks = result.data.bookmarks;

  try {
    writeConfig(updates as Parameters<typeof writeConfig>[0]);
    const updated = getConfig();
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
