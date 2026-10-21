"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePollingLifecycle } from "@/components/PollingLifecycle";
import { useConfigurationSync } from "@/components/ConfigurationSyncProvider";
import { retryAfterMilliseconds, startPolling } from "@/lib/clientPolling";

const DEFAULT_REFRESH_INTERVAL = 30_000;

interface UseWidgetResult<TData> {
  data: TData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useWidget<TData = unknown>(
  tileId: string,
  refreshInterval: number = DEFAULT_REFRESH_INTERVAL,
  widgetType?: string,
  /** Changes to persisted render inputs that require an immediate new payload. */
  fetchIdentity?: string
): UseWidgetResult<TData> {
  const [data, setData] = useState<TData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lifecycle = usePollingLifecycle();
  const dataRevision = useConfigurationSync()?.dataRevision;
  const poller = useRef<ReturnType<typeof startPolling> | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
  }, [tileId, widgetType, fetchIdentity, dataRevision]);

  useEffect(() => {
    const subscription = startPolling({
      interval: refreshInterval,
      lifecycle,
      onPause: () => setLoading(false),
      async attempt(signal) {
        setLoading(true);
        let retryAfterMs: number | undefined;
        try {
          const params = new URLSearchParams({ tile_id: tileId });
          if (widgetType) params.set("widget_type", widgetType);
          const response = await fetch(`/api/widget?${params}`, { signal });
          retryAfterMs = retryAfterMilliseconds(response.headers?.get("Retry-After"));
          const reconcile = [400, 401, 403, 404, 409].includes(response.status);
          const json = (await response.json().catch((err: unknown) => {
            // A terminal Kokpit status remains terminal even if its body was
            // replaced by an intermediary's HTML or is otherwise unreadable.
            if (reconcile) return { ok: false };
            throw err;
          })) as { ok: boolean; data?: TData; error?: string; code?: string };
          if (signal.aborted) return { kind: "success" };
          if (response.status === 401 || response.status === 403) {
            setError(json.error ?? "Authentication required");
            return { kind: "reconcile", reason: { kind: "authorization", status: response.status } };
          }
          // A source update can invalidate the request without changing its
          // saved fetch identity. Retain data/errors and retry this known case.
          if (response.status === 409 && json.code === "config_unavailable") {
            return { kind: "failure", retryAfterMs };
          }
          if ([400, 404, 409].includes(response.status)) {
            setError(json.error ?? "Widget configuration changed");
            return { kind: "reconcile", reason: { kind: "identity", status: response.status } };
          }
          if (json.ok && response.ok !== false) {
            setData(json.data ?? null);
            setError(null);
            return { kind: "success" };
          }
          setError(json.error ?? "Widget fetch failed");
        } catch (err) {
          if (!signal.aborted) setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
          if (!signal.aborted) setLoading(false);
        }
        return { kind: "failure", retryAfterMs };
      },
    });
    poller.current = subscription;
    return () => {
      subscription.dispose();
      if (poller.current === subscription) poller.current = null;
    };
  }, [tileId, widgetType, fetchIdentity, dataRevision, refreshInterval, lifecycle]);

  const refresh = useCallback(() => poller.current?.refresh(), []);
  return { data, loading, error, refresh };
}
