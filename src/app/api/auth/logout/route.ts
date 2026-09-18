import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { revokeToken, SESSION_COOKIE_NAME } from "@/auth";
import { isTrustedMutation } from "@/auth/requestGuard";

export async function POST(req: Request) {
  if (!isTrustedMutation(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const cookieStore = await cookies();
  revokeToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  cookieStore.delete(SESSION_COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
