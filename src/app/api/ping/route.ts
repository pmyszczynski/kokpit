import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/auth";
import { getConfigSnapshot } from "@/config/server";
import { fetchWithHardTimeout } from "@/lib/fetchTimeout";
import { ssrfSafeFetch } from "@/lib/ssrfGuard";

const PING_TIMEOUT_MS = 5_000;
const MAX_PING_BODY_BYTES = 1024;
const PROBE_COOLDOWN_MS = 3_000;
const MAX_CACHED_PROBES = 100;
const MAX_PENDING_PROBES = 100;

class PingBodyTooLargeError extends Error {}

type ProbeResult = { ok: true; status: number } | { ok: false };

interface ProbeCacheEntry {
  promise: Promise<ProbeResult>;
  expiresAt: number;
}

const recentProbes = new Map<string, ProbeCacheEntry>();

async function discardResponseBody(response: Response): Promise<void> {
  if (response.body && !response.bodyUsed) {
    await response.body.cancel().catch(() => {});
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PING_BODY_BYTES) {
    throw new PingBodyTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_PING_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new PingBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function pruneRecentProbes(now: number): void {
  for (const [key, entry] of recentProbes) {
    if (entry.expiresAt <= now) recentProbes.delete(key);
  }
}

function evictOldestSettledProbe(): boolean {
  for (const [key, entry] of recentProbes) {
    if (entry.expiresAt !== Number.POSITIVE_INFINITY) {
      recentProbes.delete(key);
      return true;
    }
  }
  return false;
}

/** Checks a saved launch URL, never a caller-selected destination. */
async function checkSavedService(url: string): Promise<number> {
  return fetchWithHardTimeout(
    async (signal) => {
      const response = await ssrfSafeFetch(url, {
        method: "HEAD",
        signal,
        allowPrivateNetworks: true,
        followRedirects: false,
      });
      try {
        return response.status;
      } finally {
        await discardResponseBody(response);
      }
    },
    "Service status check timed out",
    PING_TIMEOUT_MS
  );
}

function probeSavedService(serviceId: string, url: string): Promise<ProbeResult> {
  const key = `${serviceId}\u0000${url}`;
  const now = Date.now();
  const cached = recentProbes.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;
  if (cached) recentProbes.delete(key);
  pruneRecentProbes(now);
  const pendingProbes = [...recentProbes.values()].filter(
    (entry) => entry.expiresAt === Number.POSITIVE_INFINITY
  ).length;
  if (pendingProbes >= MAX_PENDING_PROBES) return Promise.resolve({ ok: false });
  while (recentProbes.size >= MAX_CACHED_PROBES && evictOldestSettledProbe()) {
    // Keep room for the new probe without ever evicting in-flight work.
  }

  const promise = checkSavedService(url)
    .then((status): ProbeResult => ({ ok: true, status }))
    .catch((): ProbeResult => ({ ok: false }));
  const entry: ProbeCacheEntry = { promise, expiresAt: Number.POSITIVE_INFINITY };
  recentProbes.set(key, entry);
  void promise.finally(() => {
    entry.expiresAt = Date.now() + PROBE_COOLDOWN_MS;
  });
  return promise;
}

export async function POST(request: Request) {
  const snapshot = getConfigSnapshot();
  if (!(await isRequestAuthenticated(
    snapshot.state === "dirty" ? undefined : snapshot.config ?? undefined
  ))) {
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
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof PingBodyTooLargeError) {
      return NextResponse.json({ error: "Request body exceeds the 1 KB limit" }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const serviceId = (body as { serviceId?: unknown } | null)?.serviceId;
  if (typeof serviceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(serviceId)) {
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

  return NextResponse.json(await probeSavedService(serviceId, target.toString()));
}
