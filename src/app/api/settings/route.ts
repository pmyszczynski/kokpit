import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isRequestAuthenticated } from "@/auth";
import { getConfig, writeConfig } from "@/config";
import { BookmarkGroupsSchema, GroupsSchema, SizeEnum } from "@/config/schema";
import { CONFIG_REVISION_HEADER, configRevision } from "@/config/revision";

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
  // Body shape is unchanged (other consumers/e2e depend on it); the revision
  // rides along as a response header for the edit-mode conflict check.
  return NextResponse.json(config, {
    headers: { [CONFIG_REVISION_HEADER]: configRevision(config) },
  });
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

  // Optimistic-concurrency check: if the caller sent the base revision it
  // captured on entry (`If-Match`), reject the write when the on-disk config
  // has changed since (e.g. a hand-edit picked up by the file watcher). Absent
  // header → back-compat, proceed as before.
  const ifMatch = request.headers.get("If-Match");
  if (ifMatch !== null) {
    const currentRevision = configRevision(getConfig());
    if (ifMatch !== currentRevision) {
      return NextResponse.json(
        {
          error:
            "settings.yaml changed since you started editing; reload before saving.",
          code: "revision_mismatch",
        },
        {
          status: 409,
          headers: { [CONFIG_REVISION_HEADER]: currentRevision },
        }
      );
    }
  }

  try {
    writeConfig(updates as Parameters<typeof writeConfig>[0]);
    const updated = getConfig();
    return NextResponse.json(updated, {
      headers: { [CONFIG_REVISION_HEADER]: configRevision(updated) },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
