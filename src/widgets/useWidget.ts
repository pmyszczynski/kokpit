"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_REFRESH_INTERVAL = 30_000;

interface UseWidgetResult<TData> {
  data: TData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useWidget<TData = unknown>(
  widgetType: string,
  config: Record<string, unknown>,
  refreshInterval: number = DEFAULT_REFRESH_INTERVAL
): UseWidgetResult<TData> {
  const [data, setData] = useState<TData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Serialize config to avoid stale closure / infinite-loop on object identity change
  const configKey = JSON.stringify(config);

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        type: widgetType,
        config: btoa(configKey),
      });
      const res = await fetch(`/api/widget?${params}`, {
        signal: controller.signal,
      });
      const json = (await res.json()) as { ok: boolean; data?: TData; error?: string };

      if (!controller.signal.aborted) {
        if (json.ok) {
          setData(json.data ?? null);
        } else {
          setError(json.error ?? "Widget fetch failed");
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetType, configKey]);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), refreshInterval);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [fetchData, refreshInterval]);

  return { data, loading, error, refresh: fetchData };
}
