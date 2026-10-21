"use client";

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AppearanceProps } from "@/config/theme";
import { applyAppearance } from "@/lib/clientAppearance";
import { createBrowserPollingLifecycle, startPolling } from "@/lib/clientPolling";
import { PollingLifecycleProvider } from "./PollingLifecycle";
import { useUnsavedChanges } from "./unsaved/UnsavedChangesProvider";

export const CONFIG_POLL_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;
let appearanceOwner: symbol | null = null;
const neutralAppearance: AppearanceProps = { theme: "dark", customCss: undefined, bgStyle: {} };

interface ConfigurationSync {
  /** Latest revision observed from the authorized endpoint or an own write. */
  revision: string | null;
  /** Revisions of the shell/data inputs delivered by the committed RSC render. */
  renderedRevision: string | null;
  dataRevision: string | null;
  registerSnapshot: (id: string, revision: string | null) => () => void;
  available: boolean;
  editable: boolean;
  stale: (baseline: string | null | undefined) => boolean;
  acknowledge: (revision: string | null) => void;
  previewTheme: (theme: string | null) => void;
  recheck: () => void;
  unavailable: () => void;
  portalHost: HTMLDivElement | null;
  revoke: () => void;
}
const Context = createContext<ConfigurationSync | null>(null);
export const useConfigurationSync = () => useContext(Context);
/** Body portals would escape the access gate; protected overlays use this host. */
export const useProtectedPortalHost = () => {
  const sync = useConfigurationSync();
  return sync ? sync.portalHost : typeof document === "undefined" ? null : document.body;
};

const browserEligible = () => document.visibilityState !== "hidden" && navigator.onLine !== false;
type Availability = "ready" | "checking" | "unavailable" | "unauthorized";

/** One authorized revision observer and access gate for the protected layout. */
export function ConfigurationSyncProvider({ children, initialRevision, initialEditable, initialAppearance, initialDataRevision }: {
  children: React.ReactNode;
  initialRevision: string | null;
  initialEditable: boolean;
  initialAppearance: AppearanceProps | null;
  /** Opaque digest of effective widget/status fetch inputs, excluding cosmetics. */
  initialDataRevision: string | null;
}) {
  const router = useRouter();
  const unsaved = useUnsavedChanges();
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  const [lifecycle] = useState(createBrowserPollingLifecycle);
  const [owner] = useState(() => Symbol("protected-appearance"));
  const [availability, setAvailability] = useState<Availability>(initialRevision ? "ready" : "checking");
  const [revision, setRevision] = useState(initialRevision);
  const [editable, setEditable] = useState(initialEditable);
  const [externalDraftChange, setExternalDraftChange] = useState(false);
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);
  const revoked = useRef(false);
  const accessRecheckPending = useRef(false);
  const revokeHandler = useRef<() => void>(() => undefined);
  const container = useRef<HTMLDivElement>(null);
  const renderedRevision = useRef(initialRevision);
  const pageSnapshots = useRef(new Map<string, string | null>());
  const snapshotsMatch = useCallback((next: string | null) =>
    [...pageSnapshots.current.values()].every((page) => page !== null && page === next), []);
  const retainedChildren = useRef(children);
  if (initialRevision && !revoked.current) retainedChildren.current = children;
  const serverAvailable = useRef(Boolean(initialRevision));
  const observedRevision = useRef(initialRevision);
  const wantedRevision = useRef<string | null>(null);
  const refreshRequested = useRef<string | null>(null);
  const refreshRequestedAt = useRef(0);
  const deferredObservation = useRef(false);
  const dataRevision = useRef(initialDataRevision);
  const releaseAfterCommit = useRef(false);
  const authorizedAppearance = useRef(initialAppearance);
  const preview = useRef<string | null>(null);
  const previewAppearance = useRef<AppearanceProps | null>(null);
  const ownWriteEpoch = useRef(0);
  const poller = useRef<ReturnType<typeof startPolling> | null>(null);
  const masked = useRef(!initialRevision);
  const hiddenDialogs = useRef(new Map<HTMLDialogElement, {
    display: string; priority: string; inert: boolean; modal: boolean; suppressClose: EventListener; focus: HTMLElement | null;
  }>());

  const applyAuthorizedAppearance = useCallback(() => {
    appearanceOwner = owner;
    const appearance = authorizedAppearance.current;
    if (masked.current || !appearance) applyAppearance(neutralAppearance);
    else {
      applyAppearance(preview.current ? previewAppearance.current ?? appearance : appearance);
      if (preview.current) document.documentElement.dataset.theme = preview.current;
    }
  }, [owner]);
  const maskDialogs = useCallback(() => {
    // Close only the native presentation, suppressing its owner dismissal.
    // This releases document-modal blocking so neutral Retry remains usable.
    document.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach((dialog) => {
      if (hiddenDialogs.current.has(dialog)) return;
      let modal = dialog.classList.contains("service-form-dialog") || dialog.classList.contains("add-tile-picker");
      try { modal ||= dialog.matches(":modal"); } catch { /* Older selector engines. */ }
      const suppressClose: EventListener = (event) => {
        event.stopImmediatePropagation();
        dialog.removeEventListener("close", suppressClose, true);
      };
      hiddenDialogs.current.set(dialog, {
        display: dialog.style.getPropertyValue("display"), priority: dialog.style.getPropertyPriority("display"), inert: dialog.inert,
        modal, suppressClose,
        focus: document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement) ? document.activeElement : null,
      });
      dialog.addEventListener("close", suppressClose, true);
      dialog.style.setProperty("display", "none", "important"); dialog.inert = true;
      dialog.close();
    });
  }, []);
  const setGate = useCallback((allowed: boolean, next: Availability) => {
    if (allowed && (revoked.current || accessRecheckPending.current || !snapshotsMatch(renderedRevision.current))) return;
    masked.current = !allowed;
    if (container.current) { container.current.hidden = !allowed; container.current.inert = !allowed; }
    if (!allowed) maskDialogs();
    else {
      hiddenDialogs.current.forEach((saved, dialog) => {
        if (saved.display) dialog.style.setProperty("display", saved.display, saved.priority);
        else dialog.style.removeProperty("display");
        dialog.inert = saved.inert;
        if (dialog.isConnected && !dialog.open) {
          if (saved.modal) dialog.showModal();
          else dialog.show();
          saved.focus?.focus();
        }
      });
      hiddenDialogs.current.clear();
    }
    lifecycle.setAccessAllowed(allowed);
    applyAuthorizedAppearance();
    setAvailability(next);
  }, [lifecycle, maskDialogs, applyAuthorizedAppearance, snapshotsMatch]);

  const registerSnapshot = useCallback((id: string, page: string | null) => {
    pageSnapshots.current.set(id, page);
    if (!page || page !== initialRevision) {
      setGate(false, page ? "checking" : "unavailable");
      poller.current?.refresh();
    } else if (masked.current) poller.current?.refresh();
    // Navigation and Strict Mode remove only this boundary's claim. A later
    // authorized poll/render owns reopening the gate, never this cleanup.
    return () => { pageSnapshots.current.delete(id); };
  }, [initialRevision, setGate]);

  const requestRender = useCallback((next: string, force = false) => {
    wantedRevision.current = next;
    if (!force && renderedRevision.current === next) return;
    if (refreshRequested.current === next && Date.now() - refreshRequestedAt.current < REQUEST_TIMEOUT_MS) return;
    refreshRequested.current = next;
    refreshRequestedAt.current = Date.now();
    router.refresh();
  }, [router]);
  const acknowledge = useCallback((next: string | null) => {
    if (!next) return;
    ownWriteEpoch.current++;
    observedRevision.current = next;
    setRevision(next);
    // The save owner already requests its existing server refresh. Mark it as
    // outstanding so a simultaneous revision poll does not issue a duplicate.
    wantedRevision.current = next;
    refreshRequested.current = next;
    refreshRequestedAt.current = Date.now();
  }, []);
  const previewTheme = useCallback((theme: string | null) => {
    if (theme && !preview.current) previewAppearance.current = authorizedAppearance.current;
    if (!theme) previewAppearance.current = null;
    preview.current = theme;
    // Keep the successful preview until its outstanding own-save render lands.
    if (!theme && wantedRevision.current && wantedRevision.current !== renderedRevision.current) return;
    applyAuthorizedAppearance();
  }, [applyAuthorizedAppearance]);
  const recheck = useCallback(() => poller.current?.refresh(), []);
  const revoke = useCallback(() => revokeHandler.current(), []);
  const unavailable = useCallback(() => {
    serverAvailable.current = false;
    setGate(false, "unavailable");
    poller.current?.refresh();
  }, [setGate]);

  useLayoutEffect(() => {
    if (revoked.current) return;
    serverAvailable.current = Boolean(initialRevision);
    if (!initialRevision) { setGate(false, "unavailable"); poller.current?.refresh(); return; }
    const changedRender = renderedRevision.current !== initialRevision;
    renderedRevision.current = initialRevision;
    authorizedAppearance.current = initialAppearance;
    if (dataRevision.current !== initialDataRevision) {
      // Pause first; child effects adopt their committed identities before the
      // provider's passive effect releases one coalesced new request.
      setGate(false, "checking");
      lifecycle.invalidate();
      dataRevision.current = initialDataRevision;
    }
    if (initialRevision === observedRevision.current) {
      refreshRequested.current = null; wantedRevision.current = null;
      releaseAfterCommit.current = true;
    } else if (changedRender) {
      setGate(false, "checking");
      poller.current?.refresh();
    }
    applyAuthorizedAppearance();
  }, [initialRevision, initialAppearance, initialDataRevision, lifecycle, setGate, applyAuthorizedAppearance]);
  useEffect(() => {
    if (releaseAfterCommit.current) {
      releaseAfterCommit.current = false;
      if (browserEligible() && serverAvailable.current && observedRevision.current === renderedRevision.current) setGate(true, "ready");
    }
  }, [initialRevision, initialDataRevision, setGate]);

  useEffect(() => {
    let disposed = false;
    let denied = false;
    let recheckTimer: number | undefined;
    let reconciliationGeneration = 0;
    let activeRevisionController: AbortController | undefined;
    applyAuthorizedAppearance();
    const dialogs = hiddenDialogs.current;
    const deny = () => {
      denied = true; revoked.current = true;
      setGate(false, "unauthorized");
      unsavedRef.current?.clear();
      retainedChildren.current = null;
      dialogs.forEach((saved, dialog) => dialog.removeEventListener("close", saved.suppressClose, true));
      dialogs.clear();
      preview.current = null; previewAppearance.current = null; authorizedAppearance.current = null;
      router.replace("/login");
      router.refresh();
    };
    const reconcile = () => {
      // Widget/status and recovery APIs can deny while YAML is transiently
      // invalid. Only the stable endpoint confirms authorization teardown.
      reconciliationGeneration++;
      accessRecheckPending.current = true;
      activeRevisionController?.abort();
      setGate(false, "checking");
      poller.current?.refresh();
    };
    revokeHandler.current = deny;
    const unregisterAuthorizationLoss = unsavedRef.current?.registerAuthorizationLoss(reconcile);
    lifecycle.setBeforeResume(() => {
      if (denied) return;
      // Ordinary focus can leave the document visible and its native editor
      // active. Only a masked resume needs a fresh access fence; join any
      // check already resolving that fence instead of restarting it.
      if (masked.current && !accessRecheckPending.current) reconcile();
      else poller.current?.refresh();
    });
    lifecycle.setReconciliationHandler(reconcile);
    const unlisten = lifecycle.subscribe(() => {
      if (!denied && !browserEligible()) setGate(false, "checking");
    });
    const subscription = startPolling({
      interval: CONFIG_POLL_INTERVAL_MS,
      lifecycle: { isEligible: () => !denied && browserEligible(), subscribe: lifecycle.subscribe, reconcile: () => undefined },
      async attempt(signal) {
        const epoch = ownWriteEpoch.current;
        const generation = reconciliationGeneration;
        const controller = new AbortController();
        activeRevisionController = controller;
        const abort = () => controller.abort();
        signal.addEventListener("abort", abort, { once: true });
        const timeout = window.setTimeout(abort, REQUEST_TIMEOUT_MS);
        try {
          const response = await fetch("/api/config/revision", { cache: "no-store", signal: controller.signal });
          if (disposed || signal.aborted) return { kind: "success" };
          if (generation !== reconciliationGeneration) {
            await response.body?.cancel().catch(() => undefined);
            return { kind: "success" };
          }
          if (response.status === 401 || response.status === 403) { deny(); return { kind: "success" }; }
          if (!response.ok) throw new Error("Configuration unavailable");
          const payload: unknown = await response.json();
          if (disposed || signal.aborted || generation !== reconciliationGeneration) return { kind: "success" };
          if (!payload || typeof payload !== "object" || !("revision" in payload) || typeof payload.revision !== "string"
            || !("editable" in payload) || typeof payload.editable !== "boolean") throw new Error("Invalid revision response");
          if (epoch !== ownWriteEpoch.current) {
            // An earlier GET cannot roll back the revision acknowledged by a
            // completed PATCH. Recheck after this subscription leaves flight.
            window.clearTimeout(recheckTimer);
            recheckTimer = window.setTimeout(() => { if (!disposed) subscription.refresh(); }, 1_000);
            return { kind: "success" };
          }
          const next = payload.revision;
          if (next !== observedRevision.current && unsavedRef.current?.saving) {
            // The file can be published before our PATCH response arrives.
            // Wait for that owner's acknowledgment before classifying it.
            deferredObservation.current = true;
            return { kind: "success" };
          }
          // A refreshed shell cannot substitute an older observed revision for
          // the fresh access check required by a child/recovery denial.
          accessRecheckPending.current = false;
          if (observedRevision.current !== next && unsavedRef.current?.dirty) setExternalDraftChange(true);
          observedRevision.current = next;
          setRevision(next); setEditable(payload.editable);
          const mixedSnapshot = !snapshotsMatch(next);
          if (next !== renderedRevision.current || !serverAvailable.current || mixedSnapshot) requestRender(next, !serverAvailable.current || mixedSnapshot);
          else { wantedRevision.current = null; refreshRequested.current = null; setGate(true, "ready"); }
          return { kind: "success" };
        } catch {
          if (generation !== reconciliationGeneration) return { kind: "success" };
          if (!disposed && !signal.aborted) setGate(false, "unavailable");
          return { kind: "failure" };
        } finally {
          window.clearTimeout(timeout);
          signal.removeEventListener("abort", abort);
          if (activeRevisionController === controller) activeRevisionController = undefined;
          if (!disposed && !signal.aborted && generation !== reconciliationGeneration) {
            window.clearTimeout(recheckTimer);
            recheckTimer = window.setTimeout(() => { if (!disposed) subscription.refresh(); }, 1_000);
          }
        }
      },
    });
    poller.current = subscription;
    if (!browserEligible()) setGate(false, "checking");
    const observer = new MutationObserver(() => { if (masked.current) maskDialogs(); });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => {
      disposed = true; window.clearTimeout(recheckTimer); subscription.dispose(); unlisten(); observer.disconnect();
      unregisterAuthorizationLoss?.();
      lifecycle.setBeforeResume(undefined); lifecycle.setReconciliationHandler(undefined);
      if (revokeHandler.current === deny) revokeHandler.current = () => undefined;
      lifecycle.setAccessAllowed(false);
      if (poller.current === subscription) poller.current = null;
      dialogs.forEach((saved, dialog) => dialog.removeEventListener("close", saved.suppressClose, true));
      dialogs.clear();
      if (appearanceOwner === owner) { applyAppearance(neutralAppearance); appearanceOwner = null; }
    };
  }, [lifecycle, maskDialogs, requestRender, router, setGate, owner, applyAuthorizedAppearance, snapshotsMatch]);

  useEffect(() => { if (!unsaved?.dirty) setExternalDraftChange(false); }, [unsaved?.dirty]);
  useEffect(() => {
    if (!unsaved?.saving && deferredObservation.current) {
      deferredObservation.current = false;
      poller.current?.refresh();
    }
  }, [unsaved?.saving]);
  const available = availability === "ready";
  const context = useMemo<ConfigurationSync>(() => ({
    revision, renderedRevision: initialRevision, dataRevision: initialDataRevision, available, editable,
    stale: (baseline) => Boolean(baseline && revision && baseline !== revision),
    acknowledge, previewTheme, recheck, unavailable, portalHost, revoke, registerSnapshot,
  }), [revision, initialRevision, initialDataRevision, available, editable, acknowledge, previewTheme, recheck, unavailable, portalHost, revoke, registerSnapshot]);
  return <Context.Provider value={context}>
    <PollingLifecycleProvider value={lifecycle}>
      {!available && <div className="config-recovery" role="status" aria-live="polite">
        <h1>{availability === "unauthorized" ? "Sign-in required" : "Checking dashboard access"}</h1>
        <p>{availability === "unavailable" ? "Configuration is temporarily unavailable. Retrying automatically." : "The dashboard will return after access and configuration are verified."}</p>
        {availability === "unavailable" && <button type="button" className="settings-btn" onClick={recheck}>Retry</button>}
      </div>}
      <div ref={container} hidden={!available} inert={!available} className="protected-surface">
        {!editable && available && <p role="alert">settings.yaml requires migration before it can be edited. Update the file to schema version 2, then retry.</p>}
        {externalDraftChange && available && <p role="alert">Configuration changed. Unsaved drafts keep their original revision; reload or discard them before saving.</p>}
        {retainedChildren.current}
        <div ref={setPortalHost} className="protected-portals" />
      </div>
    </PollingLifecycleProvider>
  </Context.Provider>;
}

/** Page-level reads can race a layout refresh; retain mounted editor owners. */
export function ConfigurationSnapshotBoundary({ revision, children }: { revision: string | null; children: React.ReactNode }) {
  const sync = useConfigurationSync();
  const id = useId();
  const retained = useRef(children);
  if (revision) retained.current = children;
  const registerSnapshot = sync?.registerSnapshot;
  useLayoutEffect(() => registerSnapshot?.(id, revision), [id, revision, registerSnapshot]);
  return <>{retained.current}</>;
}
