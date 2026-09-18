import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthSession, SESSION_COOKIE_NAME } from "@/auth";
import { isTrustedMutation } from "@/auth/requestGuard";
import { setSessionCookie } from "../../_session";

export async function POST(req: Request) {
  if (!isTrustedMutation(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const auth = await getAuthSession(token);
  if (!auth || !token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Renew the cookie only: refresh must never insert or restore a session row.
  await setSessionCookie(token);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
