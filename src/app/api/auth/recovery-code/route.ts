import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getAuthUser,
  SESSION_COOKIE_NAME,
  verifyPassword,
  generateRecoveryCode,
  hashRecoveryCode,
  setRecoveryCodeHash,
} from "@/auth";

async function getSessionUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return getAuthUser(token);
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { password } = body;
  if (typeof password !== "string" || !password) {
    return NextResponse.json({ error: "password is required" }, { status: 400 });
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const recoveryCode = generateRecoveryCode();
  setRecoveryCodeHash(user.id, hashRecoveryCode(recoveryCode));

  return NextResponse.json({ recoveryCode });
}
