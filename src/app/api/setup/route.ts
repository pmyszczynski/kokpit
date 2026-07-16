import { NextResponse } from "next/server";
import {
  countUsers,
  createUser,
  hashPassword,
  generateRecoveryCode,
  hashRecoveryCode,
  setRecoveryCodeHash,
} from "@/auth";

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

  let body: { username?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { username, password } = body;
  if (typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { error: "username and password must be strings" },
      { status: 400 }
    );
  }
  if (!username || !password) {
    return NextResponse.json(
      { error: "username and password are required" },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "password must be at least 8 characters" },
      { status: 400 }
    );
  }

  const passwordHash = await hashPassword(password);
  let user;
  try {
    // Re-check right before the insert: hashPassword awaits, so a concurrent
    // request could have raced past the check above and created a user with
    // a different username in the meantime.
    if (countUsers() > 0) {
      return NextResponse.json(
        { error: "Setup already complete" },
        { status: 409 }
      );
    }
    user = await createUser(username, passwordHash);
  } catch {
    // Username conflict (e.g. from concurrent setup requests)
    return NextResponse.json(
      { error: "Setup already complete" },
      { status: 409 }
    );
  }

  const recoveryCode = generateRecoveryCode();
  setRecoveryCodeHash(user.id, hashRecoveryCode(recoveryCode));

  return NextResponse.json(
    { id: user.id, username: user.username, recoveryCode },
    { status: 201 }
  );
}
