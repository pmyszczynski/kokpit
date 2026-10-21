import "@/integrations";
import { NextResponse } from "next/server";
import { isRequestAuthenticated } from "@/auth";
import { getConfigSnapshot, getPublishedConfigSnapshot, legacyIntegrationType } from "@/config/server";
import type { ConfigSnapshot } from "@/config/loader";
import { configRevision } from "@/config/revision";
import { getIntegration, getWidget } from "@/widgets";
import {
  widgetFetchFailure,
  widgetFetchTimeoutFailure,
} from "@/widgets/publicFetchError";
import { WidgetFetchTimeoutError } from "@/lib/fetchTimeout";
import { legacyWidgetFootprint } from "@/layout/grid";
import {
  DEFAULT_WIDGET_POLL_MS, widgetResultCache, widgetResultIdentity, widgetDefinitionIdentity,
  WidgetCacheBusyError, WidgetCacheInvalidatedError, WidgetConsumerAbortedError,
} from "@/widgets/resultCache";

/** HTTP responses remain private even though successful data is shared internally. */
function respond(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(body, { ...init, headers });
}

/** Revisions are computed only from a confirmed, usable authoritative source. */
function generationOf(snapshot: ConfigSnapshot): string | null {
  return (snapshot.state === "ready" || snapshot.state === "migration-required")
    && snapshot.config && snapshot.source ? configRevision(snapshot.source) : null;
}

function configUnavailable() {
  return respond({
    ok: false, error: "settings.yaml is being updated; retry once the change is complete",
    code: "config_unavailable",
  }, { status: 409 });
}

export async function GET(request: Request) {
  const snapshot = getConfigSnapshot();
  const generation = generationOf(snapshot);
  const epoch = widgetResultCache.observeGeneration(generation);
  if (
    !(await isRequestAuthenticated(
      snapshot.state === "dirty" ? undefined : snapshot.config ?? undefined
    ))
  ) {
    return respond({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (generation === null || !snapshot.config) return configUnavailable();
  // Authorization awaited. Never start or reuse work under an obsolete source.
  const confirmedGeneration = generationOf(getPublishedConfigSnapshot());
  widgetResultCache.observeGeneration(confirmedGeneration);
  if (confirmedGeneration !== generation || !widgetResultCache.isCurrent(epoch)) return configUnavailable();
  const config = snapshot.config;

  const { searchParams } = new URL(request.url);
  const tileId = searchParams.get("tile_id");
  const widgetType = searchParams.get("widget_type");

  if (!tileId) return respond({ ok: false, error: "Missing tile_id parameter" }, { status: 400 });
  const tile = config.service_tiles.find((candidate) => candidate.id === tileId);
  if (!tile) return respond({ ok: false, error: `ServiceTile not found: "${tileId}"` }, { status: 404 });
  if (!tile.widget) return respond({ ok: false, error: "ServiceTile has no widget" }, { status: 400 });
  if (widgetType && tile.widget.type !== widgetType) {
    return respond({ ok: false, error: "Widget type changed" }, { status: 409 });
  }
  const service = config.services.find((candidate) => candidate.id === tile.service_id);
  if (!service) return respond({ ok: false, error: `Service not found for tile "${tileId}"` }, { status: 400 });
  const type = tile.widget.type;

  const widget = getWidget(type);
  if (!widget) {
    return respond(
      { ok: false, error: `Unknown widget type: "${type}"` },
      { status: 404 }
    );
  }

  const requiredIntegration = widget.integrationType === undefined ? legacyIntegrationType(type) : widget.integrationType;
  if (requiredIntegration !== null && (!service.integration || service.integration.type !== requiredIntegration)) return respond(
    { ok: false, error: `Widget "${type}" requires integration "${requiredIntegration}"` }, { status: 400 }
  );
  const connection = service.integration?.config ?? {};
  const options = tile.widget.config ?? {};
  const conflictingKey = Object.keys(options).find((key) =>
    Object.prototype.hasOwnProperty.call(connection, key)
  );
  if (conflictingKey) return respond(
    { ok: false, error: `Tile option "${conflictingKey}" conflicts with integration configuration` },
    { status: 400 }
  );
  const integration = requiredIntegration ? getIntegration(requiredIntegration) : undefined;
  const parsedConnection = integration?.connectionSchema.safeParse(connection);
  if (parsedConnection && !parsedConnection.success) return respond({ ok: false, error: `Invalid integration config: ${parsedConnection.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}` }, { status: 400 });
  const parsedOptions = widget.optionsSchema?.safeParse(options);
  if (parsedOptions && !parsedOptions.success) return respond({ ok: false, error: `Invalid widget options: ${parsedOptions.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}` }, { status: 400 });
  const rawConfig: unknown = { ...connection, ...options };

  const parsed = widget.configSchema.safeParse(rawConfig);
  if (!parsed.success) {
    const messages = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(", ");
    return respond(
      { ok: false, error: `Invalid widget config: ${messages}` },
      { status: 400 }
    );
  }

  const footprint = tile.footprint ?? widget.supportedFootprints?.[0] ?? legacyWidgetFootprint(widget.preferredSize);
  const interval = tile.widget.refresh_interval_ms ?? widget.refreshInterval ?? DEFAULT_WIDGET_POLL_MS;
  const identity = widgetResultIdentity({
    generation, type, definition: widgetDefinitionIdentity(widget), requiredIntegration,
    mode: widget.optionsSchema ? "options" : "legacy",
    connection: parsedConnection?.data ?? connection,
    config: widget.optionsSchema ? parsedOptions?.data ?? options : parsed.data,
    footprint, timeoutMs: widget.fetchTimeoutMs,
  });
  try {
    const data = await widgetResultCache.get(identity, interval,
      (signal) => widget.optionsSchema
        ? (widget.fetchData as unknown as (connection: unknown, options: unknown, signal?: AbortSignal) => Promise<unknown>)(parsedConnection?.data ?? connection, parsedOptions?.data ?? options, signal)
        : widget.fetchData(parsed.data, signal, {
            footprint,
          }),
      widget.fetchTimeoutMs,
      request.signal
    );
    const current = getPublishedConfigSnapshot();
    const currentGeneration = generationOf(current);
    widgetResultCache.observeGeneration(currentGeneration);
    if (currentGeneration !== generation || !widgetResultCache.isCurrent(epoch)) return configUnavailable();
    // A session revoked while upstream work ran cannot receive a cache result.
    if (!(await isRequestAuthenticated(current.config!))) {
      return respond({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const finalGeneration = generationOf(getPublishedConfigSnapshot());
    widgetResultCache.observeGeneration(finalGeneration);
    if (finalGeneration !== generation || !widgetResultCache.isCurrent(epoch)) return configUnavailable();
    return respond({ ok: true, data });
  } catch (err) {
    if (err instanceof WidgetConsumerAbortedError) {
      return respond({ ok: false, error: "Request cancelled" }, { status: 499 });
    }
    if (err instanceof WidgetCacheInvalidatedError) return configUnavailable();
    if (err instanceof WidgetCacheBusyError) {
      return respond({ ok: false, error: "Widget requests are busy; retry shortly.", code: "widget_busy", retryable: true },
        { status: 503, headers: { "Retry-After": "1" } });
    }
    if (err instanceof WidgetFetchTimeoutError) {
      const failure = widgetFetchTimeoutFailure("load", type);
      return respond({ ok: false, ...failure.body }, { status: failure.status });
    }
    const failure = widgetFetchFailure("load", type, err);
    return respond({ ok: false, ...failure.body }, { status: failure.status });
  }
}
