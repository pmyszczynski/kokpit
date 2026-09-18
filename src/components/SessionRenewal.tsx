"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;

/** Keeps the persistent session cookie alive without exposing its token to JS. */
export default function SessionRenewal() {
  const router = useRouter();
  const lastSuccessfulRefresh = useRef(0);
  const refreshInFlight = useRef(false);

  useEffect(() => {
    let disposed = false;

    async function refresh() {
      if (disposed || refreshInFlight.current) return;
      if (Date.now() - lastSuccessfulRefresh.current < REFRESH_INTERVAL_MS) return;

      refreshInFlight.current = true;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch("/api/auth/session/refresh", {
          method: "POST",
          headers: { "X-Kokpit-Request": "1" },
          signal: controller.signal,
        });
        if (disposed) return;
        if (response.status === 401) {
          router.push("/login");
          router.refresh();
          return;
        }
        if (response.ok) lastSuccessfulRefresh.current = Date.now();
      } catch {
        // Network failures are retried by the next lifecycle event or interval.
      } finally {
        window.clearTimeout(timeout);
        refreshInFlight.current = false;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void refresh();
    }

    void refresh();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", refresh);
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", refresh);
      window.clearInterval(interval);
    };
  }, [router]);

  return null;
}
