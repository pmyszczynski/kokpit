import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthSession, SESSION_COOKIE_NAME } from "@/auth";

/** Expose account guidance only through a currently authenticated opaque session. */
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const auth = await getAuthSession(token);

  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }

  return NextResponse.json({
    id: auth.user.id, username: auth.user.username,
    ...(auth.session.passwordReplacementRecommended ? { passwordReplacementRecommended: true } : {}),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
