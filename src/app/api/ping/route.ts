import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/auth";
import { getConfigSnapshot, getPublishedConfigSnapshot } from "@/config/server";
import { createHash } from "node:crypto";
import type { ServiceProbeResult } from "@/lib/serviceStatus";
import { checkSavedService } from "@/lib/probeSavedService";

const MAX_PING_BODY_BYTES = 1024;
const PROBE_COOLDOWN_MS = 3_000;
const MAX_CACHED_PROBES = 100;
const MAX_PENDING_PROBES = 100;

class PingBodyTooLargeError extends Error {}

interface ProbeCacheEntry {
  promise: Promise<ServiceProbeResult>;
  expiresAt: number;
}

const recentProbes = new Map<string, ProbeCacheEntry>();

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

function probeSavedService(serviceId: string, url: string, generation: string): Promise<ServiceProbeResult> {
  const key = `${generation}\u0000${serviceId}\u0000${url}`;
  const now = Date.now();
  const cached = recentProbes.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;
  if (cached) recentProbes.delete(key);
  pruneRecentProbes(now);
  const pendingProbes = [...recentProbes.values()].filter(
    (entry) => entry.expiresAt === Number.POSITIVE_INFINITY
  ).length;
  if (pendingProbes >= MAX_PENDING_PROBES) return Promise.resolve({ ok: false, reachable: null, assessment: "unavailable", reason: "capacity", checkedAt: now, responseTimeMs: null });
  while (recentProbes.size >= MAX_CACHED_PROBES && evictOldestSettledProbe()) {
    // Keep room for the new probe without ever evicting in-flight work.
  }

  const promise = checkSavedService(url);
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

  // Authentication and streamed body parsing yield. A source change during
  // either await must not start a probe using the previous saved destination.
  const beforeProbe = getPublishedConfigSnapshot();
  if ((beforeProbe.state !== "ready" && beforeProbe.state !== "migration-required")
    || !beforeProbe.config || beforeProbe.source !== snapshot.source) {
    return NextResponse.json({ error: "Configuration changed during the status check" }, { status: 409 });
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

  // A bounded digest scopes cached work to the exact confirmed configuration
  // without retaining source secrets in map keys or exposing a public digest.
  const generation = createHash("sha256").update(snapshot.source ?? "").digest("hex");
  const result = await probeSavedService(serviceId, target.toString(), generation);
  const current = getPublishedConfigSnapshot();
  if (!(await isRequestAuthenticated(current.state === "dirty" ? undefined : current.config ?? undefined))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Session authorization yields. A publication during that await must not
  // inherit proof for the previous source/destination or public auth policy.
  const confirmed = getPublishedConfigSnapshot();
  const currentService = confirmed.config?.services.find(candidate => candidate.id === serviceId);
  if (confirmed.state === "dirty" || !confirmed.config || confirmed.source !== current.source || confirmed.source !== snapshot.source || currentService?.launch_url !== service.launch_url) {
    return NextResponse.json({ error: "Configuration changed during the status check" }, { status: 409 });
  }
  return NextResponse.json(result);
}
