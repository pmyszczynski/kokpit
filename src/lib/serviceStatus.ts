export type HttpAssessment = "reachable" | "redirect" | "authentication-required" |
  "access-restricted" | "method-unsupported" | "http-error" | "degraded";
export type UnreachableReason = "timeout" | "connection-failed" | "dns-failed";
export type UnavailableReason = "capacity" | "probe-blocked" | "checker-failed" | "configuration-changed";

interface ProbeMetadata {
  /** UTC epoch milliseconds when the observation completed, retained by cache. */
  checkedAt: number | null;
  /** Monotonic server elapsed time; successful probes stop at response headers. */
  responseTimeMs: number | null;
}

export type ServiceProbeResult = ProbeMetadata & (
  | { ok: true; reachable: true; status: number; assessment: HttpAssessment }
  | { ok: false; reachable: false; assessment: "unreachable"; reason: UnreachableReason }
  | { ok: false; reachable: null; assessment: "unavailable"; reason: UnavailableReason }
);

export function assessHttpStatus(status: number): HttpAssessment {
  if (status >= 200 && status < 300) return "reachable";
  if (status >= 300 && status < 400) return "redirect";
  if (status === 401) return "authentication-required";
  if (status === 403) return "access-restricted";
  if (status === 405 || status === 501) return "method-unsupported";
  if (status >= 500) return "degraded";
  return "http-error";
}

const UNREACHABLE_REASONS = new Set<unknown>(["timeout", "connection-failed", "dns-failed"]);
const UNAVAILABLE_REASONS = new Set<unknown>(["capacity", "probe-blocked", "checker-failed", "configuration-changed"]);

/** Older successful ping payloads are still useful; ambiguous failures are not. */
export function parseServiceProbe(value: unknown): ServiceProbeResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const metadata = {
    checkedAt: typeof raw.checkedAt === "number" && Number.isSafeInteger(raw.checkedAt) && raw.checkedAt >= 0 && raw.checkedAt <= 8_640_000_000_000_000 ? raw.checkedAt : null,
    responseTimeMs: typeof raw.responseTimeMs === "number" && Number.isFinite(raw.responseTimeMs) && raw.responseTimeMs >= 0 ? raw.responseTimeMs : null,
  };
  if (raw.ok === true && (!("reachable" in raw) || raw.reachable === true) &&
      typeof raw.status === "number" && Number.isInteger(raw.status) && raw.status >= 100 && raw.status <= 599) {
    return { ...metadata, ok: true, reachable: true, status: raw.status, assessment: assessHttpStatus(raw.status) };
  }
  if (raw.ok === false && raw.reachable === false && raw.assessment === "unreachable" && UNREACHABLE_REASONS.has(raw.reason)) {
    return { ...metadata, ok: false, reachable: false, assessment: "unreachable", reason: raw.reason as UnreachableReason };
  }
  if (raw.ok === false && raw.reachable === null && raw.assessment === "unavailable" && UNAVAILABLE_REASONS.has(raw.reason)) {
    return { ...metadata, ok: false, reachable: null, assessment: "unavailable", reason: raw.reason as UnavailableReason };
  }
  return null;
}
