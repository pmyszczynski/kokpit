import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isRequestAuthenticated } from "@/auth";
import { getConfig, invalidateCache, writeConfig } from "@/config";
import { ConfigRevisionMismatchError } from "@/config/loader";
import {
  BackgroundSchema,
  BookmarkGroupsSchema,
  GroupsSchema,
  ServiceSchema,
  ServiceTileSchema,
  KokpitConfigSchema,
} from "@/config/schema";
import { CONFIG_REVISION_HEADER, configRevision } from "@/config/revision";
import { pruneOrphanedUploads } from "@/lib/uploadGc";
import {
  toClientSafeSettings,
  resolveServiceIntegrationSecrets,
  resolveServiceTileWidgetConfigs,
  WidgetSecretResolutionError,
} from "@/widgets/configSecrets";

const PatchBodySchema = z.object({
  appearance: z
    .object({
      theme: z.enum(["dark", "light", "oled", "high-contrast"]),
      custom_css: z.string().optional(),
      card_blur: z.number().min(0).max(40).optional(),
      background: BackgroundSchema.optional(),
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
  services: z.array(ServiceSchema).optional(),
  service_tiles: z.array(ServiceTileSchema).optional(),
  groups: GroupsSchema.optional(),
  bookmarks: BookmarkGroupsSchema.optional(),
});

let pendingSettingsWrite: Promise<void> = Promise.resolve();

async function serializeSettingsWrite<T>(work: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = pendingSettingsWrite;
  pendingSettingsWrite = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

export async function GET() {
  if (!(await isRequestAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = getConfig();
  // The revision is derived from the real config while the browser receives
  // opaque references for registry-declared password fields.
  return NextResponse.json(toClientSafeSettings(config), {
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
  if (result.data.service_tiles !== undefined)
    updates.service_tiles = result.data.service_tiles;
  if (result.data.groups !== undefined) updates.groups = result.data.groups;
  if (result.data.bookmarks !== undefined)
    updates.bookmarks = result.data.bookmarks;

  const ifMatch = request.headers.get("If-Match");
  return serializeSettingsWrite(async () => {
    // Re-read only after acquiring the write lock so concurrent requests and
    // external settings.yaml changes cannot validate against a stale revision.
    invalidateCache();
    const current = getConfig();
    const currentRevision = configRevision(current);
    if (ifMatch !== null && ifMatch !== currentRevision) {
      return NextResponse.json(
        { error: "settings.yaml changed since you started editing; reload before saving.", code: "revision_mismatch" },
        { status: 409, headers: { [CONFIG_REVISION_HEADER]: currentRevision } }
      );
    }
    try {
      if (result.data.services !== undefined) {
        updates.services = resolveServiceIntegrationSecrets(result.data.services, current.services);
      }
      if (result.data.service_tiles !== undefined) {
        updates.service_tiles = resolveServiceTileWidgetConfigs(result.data.service_tiles, current.service_tiles);
      }
    } catch (error) {
      if (error instanceof WidgetSecretResolutionError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
      }
      return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
    }
    const candidate = KokpitConfigSchema.safeParse({ ...current, ...updates });
    if (!candidate.success) {
      return NextResponse.json({
        error: candidate.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", "),
        code: "config_invalid",
      }, { status: 400 });
    }
    try {
      writeConfig(updates as Parameters<typeof writeConfig>[0], currentRevision);
      const updated = getConfig();
      await pruneOrphanedUploads(updated);
      return NextResponse.json(toClientSafeSettings(updated), {
        headers: { [CONFIG_REVISION_HEADER]: configRevision(updated) },
      });
    } catch (error) {
      if (error instanceof ConfigRevisionMismatchError) {
        return NextResponse.json(
          { error: "settings.yaml changed since you started editing; reload before saving.", code: "revision_mismatch" },
          { status: 409, headers: { [CONFIG_REVISION_HEADER]: error.currentRevision } }
        );
      }
      return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
    }
  });
}
