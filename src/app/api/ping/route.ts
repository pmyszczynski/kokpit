import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");

  if (!raw) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Invalid url parameter" }, { status: 400 });
  }

  try {
    let response = await fetch(target.toString(), {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
      redirect: "follow",
    });

    // Some servers don't allow HEAD — fall back to GET
    if (response.status === 405) {
      response = await fetch(target.toString(), {
        method: "GET",
        signal: AbortSignal.timeout(5000),
        redirect: "follow",
      });
    }

    return NextResponse.json({ ok: true, status: response.status });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
