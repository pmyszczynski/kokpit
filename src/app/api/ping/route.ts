import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/auth";
import { getConfigSnapshot } from "@/config/server";
import { fetchWithHardTimeout } from "@/lib/fetchTimeout";
import { ssrfSafeFetch } from "@/lib/ssrfGuard";

const PING_TIMEOUT_MS = 5_000;

async function discardResponseBody(response: Response): Promise<void> {
  if (response.body && !response.bodyUsed) {
    await response.body.cancel().catch(() => {});
  }
}

/** Checks a saved launch URL, never a caller-selected destination. */
async function checkSavedService(url: string): Promise<number> {
  return fetchWithHardTimeout(
    async (signal) => {
      let response = await ssrfSafeFetch(url, {
        method: "HEAD",
        signal,
        // Homelab services commonly use LAN addresses. The shared guard still
        // blocks link-local/reserved ranges and validates redirects and DNS.
        allowPrivateNetworks: true,
      });
      try {
        if (response.status === 405) {
          await discardResponseBody(response);
          response = await ssrfSafeFetch(url, {
            method: "GET",
            signal,
            allowPrivateNetworks: true,
          });
        }
        return response.status;
      } finally {
        await discardResponseBody(response);
      }
    },
    "Service status check timed out",
    PING_TIMEOUT_MS
  );
}

export async function POST(request: Request) {
  const snapshot = getConfigSnapshot();
  if (!(await isRequestAuthenticated(snapshot.state === "dirty" ? undefined : snapshot.config ?? undefined))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (snapshot.state === "dirty" || !snapshot.config) {
    return NextResponse.json({ error: "Configuration is being updated" }, { status: 409 });
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return NextResponse.json({ error: "Unsupported content type" }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const serviceId = (body as { serviceId?: unknown } | null)?.serviceId;
  if (typeof serviceId !== "string" || serviceId === "") {
    return NextResponse.json({ error: "Missing serviceId" }, { status: 400 });
  }

  const service = snapshot.config.services.find((candidate) => candidate.id === serviceId);
  if (!service) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }
  if (!service.launch_url) {
    return NextResponse.json({ error: "Service has no launch URL" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(service.launch_url);
  } catch {
    return NextResponse.json({ error: "Service has an invalid launch URL" }, { status: 400 });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json({ error: "Service has an invalid launch URL" }, { status: 400 });
  }

  try {
    const status = await checkSavedService(target.toString());
    return NextResponse.json({ ok: true, status });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
