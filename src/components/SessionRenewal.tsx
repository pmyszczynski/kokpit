"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;

/** Keeps the persistent session cookie alive without exposing its token to JS. */
export default function SessionRenewal() {
  const router = useRouter();

  useEffect(() => {
    let disposed = false;
    let lastSuccessfulRefresh = 0;
    let refreshInFlight = false;
    let nextRefresh: number | undefined;
    let activeController: AbortController | undefined;

    async function refresh() {
      if (disposed || refreshInFlight) return;
      if (Date.now() - lastSuccessfulRefresh < REFRESH_INTERVAL_MS) return;

      refreshInFlight = true;
      window.clearTimeout(nextRefresh);
      const controller = new AbortController();
      activeController = controller;
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
        if (response.ok) lastSuccessfulRefresh = Date.now();
      } catch {
        // Network failures are retried by the next lifecycle event or interval.
      } finally {
        window.clearTimeout(timeout);
        refreshInFlight = false;
        activeController = undefined;
        if (!disposed) nextRefresh = window.setTimeout(refresh, REFRESH_INTERVAL_MS);
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") void refresh();
    }

    void refresh();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", refresh);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", refresh);
      window.clearTimeout(nextRefresh);
      activeController?.abort();
    };
  }, [router]);

  return null;
}
