"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePollingLifecycle } from "./PollingLifecycle";
import { useProtectedPortalHost } from "./ConfigurationSyncProvider";
import { retryAfterMilliseconds, startPolling } from "@/lib/clientPolling";
import { parseServiceProbe, type ServiceProbeResult, type UnavailableReason } from "@/lib/serviceStatus";

type Observation = Exclude<ServiceProbeResult, { reachable: null }>;
type CheckFailure = UnavailableReason | "authorization" | "invalid-response";
interface StatusState { observation: Observation | null; unavailable: CheckFailure | null }

const ASSESSMENT = {
  reachable: "Reachable",
  redirect: "Reachable; redirect returned; application health unknown",
  "authentication-required": "Reachable; authentication required",
  "access-restricted": "Reachable; access restricted",
  "method-unsupported": "Reachable; HEAD unsupported; application health unknown",
  "http-error": "Reachable; HTTP error; application health unknown",
  degraded: "Reachable; degraded (HTTP server error)",
};
const FAILURE = {
  capacity: "status checker is busy",
  "probe-blocked": "destination could not be probed safely",
  "checker-failed": "status checker could not complete the request",
  "configuration-changed": "saved configuration changed; waiting for refresh",
  authorization: "dashboard authentication is required",
  "invalid-response": "status checker returned an invalid response",
};

function observationLabel(observation: Observation, now: number): string {
  const assessment = observation.reachable
    ? `${ASSESSMENT[observation.assessment]}; HTTP ${observation.status}`
    : `Unreachable from Kokpit; ${observation.reason === "timeout" ? "probe timed out" : observation.reason === "dns-failed" ? "DNS lookup failed" : "connection failed"}`;
  const latency = observation.responseTimeMs === null ? "latency unavailable"
    : `${observation.responseTimeMs} ms ${observation.reachable ? "to headers" : "probe elapsed"}`;
  const checked = observation.checkedAt === null ? "check time unavailable"
    : `checked ${new Date(observation.checkedAt).toISOString()} (${Math.max(0, Math.floor((now - observation.checkedAt) / 1000))}s ago)`;
  return `${assessment}; ${latency}; ${checked}`;
}

/** Reachability indicator; the dashboard request's own failure is never an outage. */
export function ServiceStatus({ serviceId, preview, insideLink = false }: { serviceId: string; preview?: boolean; insideLink?: boolean }) {
  const [state, setState] = useState<StatusState>({ observation: null, unavailable: null });
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [tooltipNow, setTooltipNow] = useState(Date.now);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tooltipId = useId();
  const lifecycle = usePollingLifecycle();
  const portalHost = useProtectedPortalHost();
  const tooltipOpen = (hovered || focused) && !dismissed;

  useEffect(() => {
    if (preview) return;
    setState({ observation: null, unavailable: null });
    const unavailable = (reason: CheckFailure) => {
      setTooltipNow(Date.now());
      setState(previous => ({ ...previous, unavailable: reason }));
    };
    const subscription = startPolling({
      interval: 30_000,
      lifecycle,
      async attempt(signal) {
        let retryAfterMs: number | undefined;
        try {
          const response = await fetch("/api/ping", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serviceId }), signal,
          });
          if (signal.aborted) return { kind: "success" };
          retryAfterMs = retryAfterMilliseconds(response.headers?.get("Retry-After"));
          // Temporary configuration conflicts can recover without a new identity.
          // Keep the last observation and retry; this is not a service outage.
          if (response.status === 409) {
            unavailable("configuration-changed");
            return { kind: "failure", retryAfterMs };
          }
          if ([401, 403, 400, 404].includes(response.status)) {
            const authorization = response.status === 401 || response.status === 403;
            unavailable(authorization ? "authorization" : "configuration-changed");
            return { kind: "reconcile", reason: { kind: authorization ? "authorization" : "identity", status: response.status } };
          }
          if (response.ok === false) {
            unavailable(response.status === 429 || response.status === 503 ? "capacity" : "checker-failed");
            return { kind: "failure", retryAfterMs };
          }
          const result = parseServiceProbe(await response.json());
          if (signal.aborted) return { kind: "success" };
          if (!result) {
            unavailable("invalid-response");
            return { kind: "failure", retryAfterMs };
          }
          if (result.reachable === null) {
            unavailable(result.reason);
            return { kind: "failure", retryAfterMs };
          }
          setTooltipNow(Date.now());
          setState({ observation: result, unavailable: null });
          // A service HTTP error is still a completed observation. Only probe
          // transport failures back off; application health is a separate fact.
          return result.reachable ? { kind: "success" } : { kind: "failure", retryAfterMs };
        } catch {
          if (!signal.aborted) unavailable("checker-failed");
          return { kind: "failure", retryAfterMs };
        }
      },
    });
    return () => subscription.dispose();
  }, [serviceId, preview, lifecycle]);

  useEffect(() => {
    if (!tooltipOpen) return;
    const update = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (rect) setPosition({
        left: Math.max(8, Math.min(rect.right - 280, window.innerWidth - 288)),
        ...(rect.top >= window.innerHeight / 2 ? { bottom: window.innerHeight - rect.top } : { top: rect.bottom }),
      });
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setDismissed(true); };
    update();
    setTooltipNow(Date.now());
    // This only updates an open tooltip's age; it sends no network activity.
    const ageTimer = setInterval(() => setTooltipNow(Date.now()), 1000);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("keydown", escape);
    return () => {
      clearInterval(ageTimer);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("keydown", escape);
    };
  }, [tooltipOpen]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    // Plain tiles are themselves links. Reuse that keyboard stop instead of
    // introducing a focusable descendant inside an anchor.
    if (!insideLink) return;
    const link = anchor.current?.closest("a");
    if (!link) return;
    const focus = () => { setFocused(true); setDismissed(false); };
    const blur = () => setFocused(false);
    link.addEventListener("focus", focus);
    link.addEventListener("blur", blur);
    // Hydration or a configuration refresh can mount this indicator after its
    // launch link received focus; that earlier native event will not replay.
    if (document.activeElement === link) focus();
    return () => { link.removeEventListener("focus", focus); link.removeEventListener("blur", blur); };
  }, [insideLink]);

  useEffect(() => {
    if (!insideLink || !tooltipOpen || !position || !portalHost) return;
    const link = anchor.current?.closest("a");
    if (!link) return;
    const describedBy = link.getAttribute("aria-describedby")?.split(/\s+/).filter(Boolean) ?? [];
    link.setAttribute("aria-describedby", [...new Set([...describedBy, tooltipId])].join(" "));
    return () => {
      // Only remove our token so other descriptions added while open survive.
      const remaining = link.getAttribute("aria-describedby")?.split(/\s+/).filter(id => id && id !== tooltipId) ?? [];
      if (remaining.length) link.setAttribute("aria-describedby", remaining.join(" "));
      else link.removeAttribute("aria-describedby");
    };
  }, [insideLink, tooltipOpen, position, tooltipId, portalHost]);

  const show = () => { clearTimeout(closeTimer.current); setHovered(true); setDismissed(false); };
  const hide = () => { closeTimer.current = setTimeout(() => setHovered(false), 150); };
  const previous = state.observation ? observationLabel(state.observation, tooltipNow) : null;
  const label = state.unavailable ? `Status unavailable; ${FAILURE[state.unavailable]}${previous ? `. Last observation: ${previous}` : ""}`
    : previous ?? "Checking service reachability";
  const assessment = state.observation?.assessment;
  const tone = state.unavailable ? "unavailable" : !assessment ? "pending" : assessment === "unreachable" ? "error"
    : assessment === "degraded" ? "degraded" : assessment === "reachable" ? "ok" : "warning";

  return <>
    <div ref={anchor} className={`status-dot status-dot--${tone}`} role="img" tabIndex={insideLink ? undefined : 0}
      title={hovered || focused ? undefined : label} aria-label={label} aria-describedby={!insideLink && tooltipOpen && position && portalHost ? tooltipId : undefined} data-status-assessment={state.unavailable ? "unavailable" : assessment ?? "pending"}
      onMouseEnter={show} onMouseLeave={hide}
      onFocus={() => { setFocused(true); setDismissed(false); }} onBlur={() => setFocused(false)} />
    {tooltipOpen && position && portalHost && createPortal(
      <div id={tooltipId} role="tooltip" className="service-status-tooltip" style={position} onMouseEnter={show} onMouseLeave={hide}>
        {label}
      </div>, portalHost)}
  </>;
}
