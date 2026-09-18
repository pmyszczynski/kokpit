import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  generateRecoveryCode,
  hashRecoveryCode,
  setRecoveryCodeHash,
  verifySessionPassword,
} from "@/auth";
import { isTrustedMutation } from "@/auth/requestGuard";

async function getSessionToken() {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value;
}

export async function POST(req: Request) {
  if (!isTrustedMutation(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { password } = body as { password?: unknown };
  const token = await getSessionToken();
  const verified = await verifySessionPassword(token, password);
  if (!("auth" in verified)) return NextResponse.json({ error: verified.error }, { status: verified.status });

  const recoveryCode = generateRecoveryCode();
  // verifySessionPassword re-reads the session after bcrypt. This synchronous
  // write cannot race an await between authorization and mutation.
  setRecoveryCodeHash(verified.auth.user.id, hashRecoveryCode(recoveryCode));

  return NextResponse.json({ recoveryCode });
}
