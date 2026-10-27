import { fetchWithHardTimeout, WidgetFetchTimeoutError } from "./fetchTimeout";
import { ssrfSafeFetch } from "./ssrfGuard";
import { performance } from "node:perf_hooks";
import { assessHttpStatus, type ServiceProbeResult } from "./serviceStatus";

const PING_TIMEOUT_MS = 5_000;

async function discardResponseBody(response: Response): Promise<void> {
  try {
    if (response.body && !response.bodyUsed) await response.body.cancel();
  } catch { /* Best-effort cleanup must not erase observed response headers. */ }
}

/** Checks a saved launch URL, never a caller-selected destination. */
export async function checkSavedService(url: string): Promise<ServiceProbeResult> {
  const started = performance.now();
  const metadata = () => ({ checkedAt: Date.now(), responseTimeMs: Math.max(0, Math.round((performance.now() - started) * 10) / 10) });
  try {
    return await fetchWithHardTimeout(
      async (signal) => {
        const response = await ssrfSafeFetch(url, {
          method: "HEAD",
          signal,
          allowPrivateNetworks: true,
          followRedirects: false,
        });
        // Stop latency at headers, and release discarded bodies without allowing
        // cancellation cleanup to erase an already observed HTTP response.
        const observed = metadata();
        void discardResponseBody(response);
        if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
          return { ok: false, reachable: null, assessment: "unavailable", reason: "checker-failed", ...observed };
        }
        return { ok: true, reachable: true, status: response.status, assessment: assessHttpStatus(response.status), ...observed };
      },
      "Service status check timed out",
      PING_TIMEOUT_MS
    );
  } catch (error) {
    const observed = metadata();
    if (error instanceof WidgetFetchTimeoutError) {
      return { ok: false, reachable: false, assessment: "unreachable", reason: "timeout", ...observed };
    }
    if (error instanceof Error && error.name === "SsrfBlockedError") {
      const reason = (error as Error & { reason?: string }).reason;
      return reason === "dns-failed"
        ? { ok: false, reachable: false, assessment: "unreachable", reason: "dns-failed", ...observed }
        : { ok: false, reachable: null, assessment: "unavailable", reason: reason === "dns-unavailable" ? "checker-failed" : "probe-blocked", ...observed };
    }
    const codes = new Set([
      "ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "EPIPE", "ETIMEDOUT", "EHOSTUNREACH", "EHOSTDOWN",
      "ENETUNREACH", "ENETDOWN", "ENETRESET", "ENOTFOUND", "ERR_SOCKET_CLOSED", "ERR_SOCKET_CONNECTION_TIMEOUT",
      "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET", "CERT_HAS_EXPIRED",
      "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_GET_ISSUER_CERT", "ERR_TLS_CERT_ALTNAME_INVALID",
    ]);
    const networkError = (candidate: unknown): boolean => {
      const knownCode = (code: unknown) => typeof code === "string" &&
        (codes.has(code) || code.startsWith("ERR_TLS_") || code.startsWith("ERR_SSL_") || code.startsWith("CERT_"));
      const seen = new Set<object>();
      for (let depth = 0; depth < 8 && candidate && typeof candidate === "object"; depth++) {
        if (seen.has(candidate)) return false;
        seen.add(candidate);
        const value = candidate as { code?: unknown; cause?: unknown };
        if (knownCode(value.code)) return true;
        candidate = value.cause;
      }
      return false;
    };
    if (networkError(error)) {
      return { ok: false, reachable: false, assessment: "unreachable", reason: "connection-failed", ...observed };
    }
    return { ok: false, reachable: null, assessment: "unavailable", reason: "checker-failed", ...observed };
  }
}
