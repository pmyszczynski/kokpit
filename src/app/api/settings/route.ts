import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthUser, SESSION_COOKIE_NAME } from "@/auth";
import { getConfig, writeConfig } from "@/config";

async function checkAuth(): Promise<boolean> {
  const config = getConfig();
  const authEnabled =
    config.auth.enabled && process.env.KOKPIT_AUTH_DISABLED !== "true";
  if (!authEnabled) return true;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const user = await getAuthUser(token);
  return !!user;
}

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
      })
    )
    .optional(),
});

export async function GET() {
  if (!(await checkAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = getConfig();
  return NextResponse.json(config);
}

export async function PATCH(request: NextRequest) {
  if (!(await checkAuth())) {
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

  try {
    writeConfig(updates as Parameters<typeof writeConfig>[0]);
    const updated = getConfig();
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
