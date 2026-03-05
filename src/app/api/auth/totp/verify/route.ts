import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "TOTP not yet implemented" },
    { status: 501 }
  );
}
