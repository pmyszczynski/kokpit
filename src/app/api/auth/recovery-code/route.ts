import { AUTH_JSON_BODY_BYTES, readJsonObject, RequestBodyError } from "@/lib/requestBody";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  generateRecoveryCode,
  hashRecoveryCode,
  setRecoveryCodeHash,
  verifySessionPassword,
  getAuthSession,
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

  const token = await getSessionToken();
  if (!(await getAuthSession(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(req, AUTH_JSON_BODY_BYTES);
  } catch (error) {
    return NextResponse.json({ error: error instanceof RequestBodyError ? error.message : "Invalid JSON" },
      { status: error instanceof RequestBodyError ? error.status : 400 });
  }

  const { password } = body as { password?: unknown };
  const verified = await verifySessionPassword(token, password);
  if (!("auth" in verified)) return NextResponse.json({ error: verified.error }, { status: verified.status });

  const recoveryCode = generateRecoveryCode();
  // verifySessionPassword re-reads the session after bcrypt. This synchronous
  // write cannot race an await between authorization and mutation.
  setRecoveryCodeHash(verified.auth.user.id, hashRecoveryCode(recoveryCode));

  return NextResponse.json({ recoveryCode });
}
