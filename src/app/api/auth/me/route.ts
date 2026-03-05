import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuthUser, SESSION_COOKIE_NAME } from "@/auth";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const user = await getAuthUser(token);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ id: user.id, username: user.username });
}
