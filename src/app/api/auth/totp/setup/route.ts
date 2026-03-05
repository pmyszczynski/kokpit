import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "TOTP not yet implemented" },
    { status: 501 }
  );
}
