import { NextResponse } from "next/server";
import { countUsers, createUser, hashPassword } from "@/auth";

export async function GET(_req: Request) {
  return NextResponse.json({ setupRequired: countUsers() === 0 });
}

export async function POST(req: Request) {
  if (countUsers() > 0) {
    return NextResponse.json(
      { error: "Setup already complete" },
      { status: 409 }
    );
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { username, password } = body;
  if (!username || !password) {
    return NextResponse.json(
      { error: "username and password are required" },
      { status: 400 }
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser(username, passwordHash);

  return NextResponse.json(
    { id: user.id, username: user.username },
    { status: 201 }
  );
}
