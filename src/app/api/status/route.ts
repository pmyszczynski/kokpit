import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/auth";
import { getConfigSnapshot, getPublishedConfigSnapshot } from "@/config/server";
import { checkSavedService } from "@/lib/probeSavedService";
import { createServiceStatusScheduler } from "@/lib/serviceStatusScheduler";

export const dynamic = "force-dynamic";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const scheduler = createServiceStatusScheduler({ probe: checkSavedService, isCurrent(generation) {
  const snapshot = getPublishedConfigSnapshot();
  return (snapshot.state === "ready" || snapshot.state === "migration-required") && snapshot.config !== null &&
    snapshot.source !== null && digest(snapshot.source) === generation;
} });
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
});

/** Batch only saved IDs; reauthorize after shared work before exposing results. */
export async function GET(request: Request) {
  const snapshot = getConfigSnapshot();
  if (!(await isRequestAuthenticated(snapshot.state === "dirty" ? undefined : snapshot.config ?? undefined))) return json({ error: "Unauthorized" }, 401);
  if ((snapshot.state !== "ready" && snapshot.state !== "migration-required") || !snapshot.config || !snapshot.source) return json({ error: "Configuration is being updated" }, 409);
  const query = new URL(request.url).searchParams;
  const ids = query.getAll("ids");
  const requested = ids.length === 1 ? ids[0].split(",") : [];
  if (!requested.length || requested.length > 20 || requested.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) return json({ error: "Provide 1–20 saved service UUIDs in ids" }, 400);
  const targets: { id: string; url: string }[] = [];
  for (const id of new Set(requested)) {
    const service = snapshot.config.services.find(service => service.id === id);
    if (!service) return json({ error: "Service not found" }, 404);
    try {
      const url = new URL(service.launch_url ?? "");
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      targets.push({ id, url: url.href });
    } catch { return json({ error: "Service has no valid HTTP(S) launch URL" }, 400); }
  }
  const before = getPublishedConfigSnapshot();
  if ((before.state !== "ready" && before.state !== "migration-required") || !before.config || before.source !== snapshot.source) return json({ error: "Configuration changed during the status check" }, 409);
  const generation = digest(snapshot.source);
  const statuses = Object.fromEntries(await Promise.all(targets.map(async target => [target.id,
    await scheduler.get(digest(`${generation}\0${target.id}\0${target.url}`), target.url, generation),
  ])));
  const current = getPublishedConfigSnapshot();
  if (!(await isRequestAuthenticated(current.state === "dirty" ? undefined : current.config ?? undefined))) return json({ error: "Unauthorized" }, 401);
  const confirmed = getPublishedConfigSnapshot();
  if ((confirmed.state !== "ready" && confirmed.state !== "migration-required") || !confirmed.config || confirmed.source !== current.source || confirmed.source !== snapshot.source) return json({ error: "Configuration changed during the status check" }, 409);
  return json({ statuses });
}
