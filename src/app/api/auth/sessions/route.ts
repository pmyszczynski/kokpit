import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthSession, listSessions, revokeSession, revokeUserSessions, SESSION_COOKIE_NAME } from "@/auth";
import { isTrustedMutation } from "@/auth/requestGuard";
import { verifySessionPassword } from "@/auth/reauthenticate";

const Mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("revoke"), sessionId: z.uuid(), password: z.string().optional() }),
  z.object({ action: z.literal("revoke-others"), password: z.string() }),
  z.object({ action: z.literal("revoke-all"), password: z.string() }),
]);

export async function GET() {
  const cookieStore = await cookies();
  const auth = await getAuthSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    sessions: listSessions(auth.user.id).map((session) => ({
      id: session.id,
      device: session.device,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      current: session.id === auth.session.id,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!isTrustedMutation(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const auth = await getAuthSession(token);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Mutation.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid session action" }, { status: 400 });
  const body = parsed.data;
  const currentOnly = body.action === "revoke" && body.sessionId === auth.session.id;
  if (!currentOnly) {
    const proof = await verifySessionPassword(token, body.password);
    if ("error" in proof) return NextResponse.json({ error: proof.error }, { status: proof.status });
  }
  // No asynchronous work between the final authorization and deletion.
  if (body.action === "revoke") revokeSession(auth.user.id, body.sessionId);
  else revokeUserSessions(auth.user.id, body.action === "revoke-others" ? auth.session.id : undefined);
  if (currentOnly || body.action === "revoke-all") cookieStore.delete(SESSION_COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
