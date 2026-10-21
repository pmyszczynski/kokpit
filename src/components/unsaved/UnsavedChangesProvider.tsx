"use client";

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CONFIG_REVISION_HEADER } from "@/config/revisionHeader";

export interface UnsavedSource {
  label: string;
  dirty: boolean;
  saving?: boolean;
  /** Dashboard drafts survive ordinary navigation within the protected layout. */
  survivesNavigation?: boolean;
  scope?: "dashboard" | "settings";
  /** Configuration baseline for write owners; child forms may leave it undefined. */
  writeRevision?: string | null;
  /** Child forms transfer their values before a containing draft is saved. */
  priority?: number;
  /** Changes whenever the normalized submitted fields change. */
  version?: string;
  discard: () => void;
  /** True only when the submitted snapshot succeeded and no later edits remain. */
  save?: () => Promise<boolean>;
}

type GuardOptions = {
  ids?: string[]; excludeIds?: string[]; navigation?: boolean; scope?: "dashboard" | "settings";
  /** The caller clears drafts only after its external operation succeeds. */
  deferDiscard?: boolean;
};
export type RecoverySnapshot<T = unknown> = { revision: string | null; value: T; dirty?: boolean; owner?: string; conflicted?: boolean };
type Confirmation = { options: GuardOptions; resolve: (allowed: boolean) => void; focus: HTMLElement | null };
type RevisionCheck = { state: "ready"; revision: string } | { state: "unavailable" | "unauthorized" | "superseded" };

interface UnsavedChangesContextValue {
  dirty: boolean;
  saving: boolean;
  revisionCheckGeneration: number;
  register: (id: string, source: () => UnsavedSource) => () => void;
  changed: () => void;
  confirm: (options?: GuardOptions) => Promise<boolean>;
  clear: () => void;
  readRecovery: <T>(id: string) => RecoverySnapshot<T> | undefined;
  writeRecovery: (id: string, snapshot: RecoverySnapshot) => boolean;
  removeRecovery: (id: string, owner?: string) => void;
  removeRecoveryScope: (scope: "dashboard" | "settings") => void;
  acknowledgeRecovery: (id: string, owner: string, revision: string | null, compatibleChildrenFrom?: string) => void;
  verifyRevision: () => Promise<RevisionCheck>;
  beginWrite: () => () => void;
}

const Context = createContext<UnsavedChangesContextValue | null>(null);
const MAX_RECOVERIES = 32;
const MAX_RECOVERY_BYTES = 256 * 1024;

/**
 * Owners pass explicit non-secret projections, never raw integration config.
 * This defensive filter also removes known credential fields and URL secrets.
 */
export function sanitizeRecovery(value: unknown): unknown {
  return sanitizeRecoveryValue(value);
}

function sanitizeRecoveryValue(value: unknown, urlField = false): unknown {
  if (Array.isArray(value)) return value.map((child) => sanitizeRecoveryValue(child, urlField));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) =>
      !/(password|secret|token|api[_-]?key|authorization|cookie|credential|totp|recovery|integrationConfig|widgetConfig|orphanWidget)/i.test(key)
    ).filter(([key, child]) => {
      // Recovery accepts a limited CSS profile. Omit URL delimiters and
      // arbitrary custom-property values instead of partially parsing CSS.
      return !/^(custom_?css|bgGradient|gradient)$/i.test(key) || typeof child !== "string"
        || !/(?:["'\\/?#@]|url\s*\(|(?:^|[;{])\s*--)/i.test(child);
    }).map(([key, child]) => [key, sanitizeRecoveryValue(child, /^(url|launch_url|icon|bgImage)$/i.test(key))]));
  }
  let urlCandidate = typeof value === "string"
    ? value.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "").replace(/[\t\r\n]/g, "") : "";
  // Browsers treat backslashes as slashes in HTTP authorities too. Normalize
  // only known URL fields so ordinary free text still remains verbatim.
  if (urlField) urlCandidate = urlCandidate.replace(/\\/g, "/");
  // Ordinary descriptions may begin with a colon or slash. URL fields also
  // sanitize relative and browser-normalized forms, which can carry secrets.
  const looksLikeUrl = /^(?:[a-z][a-z\d+.-]*:\/\/|\/\/)/i.test(urlCandidate)
    || urlField && /^(?:(?:https?|ftp|wss?|file):|\/)/i.test(urlCandidate);
  if (typeof value === "string" && looksLikeUrl) {
    try {
      const trimmed = urlCandidate;
      const url = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
        ? new URL(trimmed) : new URL(trimmed, "https://recovery.invalid");
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return trimmed.startsWith("//") ? `//${url.host}${url.pathname}`
        : trimmed.startsWith("/") ? url.pathname : url.href;
    } catch { return ""; }
  }
  if (typeof value === "string" && urlField) {
    // Incomplete/schemeless editor values may still contain query, fragment or
    // authority credentials. Do not retain them while waiting for a valid URL.
    const path = urlCandidate.split(/[?#]/, 1)[0];
    const authorityEnd = path.search(/[\/\\]/);
    const authority = authorityEnd < 0 ? path : path.slice(0, authorityEnd);
    return authority.slice(authority.lastIndexOf("@") + 1) + (authorityEnd < 0 ? "" : path.slice(authorityEnd));
  }
  return value;
}

function compatibleWrites(sources: UnsavedSource[]) {
  return new Set(sources.flatMap((source) => source.scope ? [source.scope] : [])).size <= 1
    && new Set(sources.flatMap((source) => source.writeRevision === undefined ? [] : [source.writeRevision])).size <= 1;
}

/** Layout-lifetime registry; no browser storage or history interception. */
export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const sources = useRef(new Map<string, () => UnsavedSource>());
  const pendingWrites = useRef(0);
  const recoveries = useRef(new Map<string, RecoverySnapshot>());
  const [version, setVersion] = useState(0);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const confirmationRef = useRef<Confirmation | null>(null);
  const [working, setWorking] = useState(false);
  const verification = useRef<Promise<RevisionCheck> | null>(null);
  const verificationController = useRef<AbortController | null>(null);
  const verificationGeneration = useRef(0);
  const mounted = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const stay = useRef<HTMLButtonElement>(null);
  const changed = useCallback(() => setVersion((value) => value + 1), []);
  const beginWrite = useCallback(() => {
    // A pre-write check cannot verify a post-write draft, even if its fetch
    // ignores cancellation or completes after a newer request has started.
    verificationGeneration.current++;
    verification.current = null;
    verificationController.current?.abort();
    verificationController.current = null;
    pendingWrites.current++;
    changed();
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      pendingWrites.current--;
      if (mounted.current) changed();
    };
  }, [changed]);
  const register = useCallback((id: string, source: () => UnsavedSource) => {
    sources.current.set(id, source);
    changed();
    return () => { sources.current.delete(id); changed(); };
  }, [changed]);
  const selected = useCallback((options: GuardOptions = {}) => {
    const available = new Map(sources.current);
    if (pendingWrites.current > 0) available.set("pending-editor-writes", () => ({
      label: "Save in progress", dirty: false, saving: true, discard: () => undefined,
    }));
    recoveries.current.forEach((snapshot, id) => {
      if (snapshot.dirty === false || available.has(id) || id === "settings" && available.has("settings:appearance")) return;
      available.set(id, () => ({
        label: "Retained unsaved editor draft", dirty: true, survivesNavigation: true,
        scope: id.startsWith("settings") ? "settings" : "dashboard",
        discard: () => { recoveries.current.delete(id); changed(); },
      }));
    });
    return [...available.entries()].filter(([id, source]) => {
      const current = source();
      return (current.dirty || current.saving) && (!options.ids || options.ids.includes(id))
        && !options.excludeIds?.includes(id)
        && (!options.scope || current.scope === options.scope)
        && (!options.navigation || !current.survivesNavigation);
    }).sort((left, right) => (left[1]().priority ?? 10) - (right[1]().priority ?? 10));
  }, [changed]);
  const confirm = useCallback((options: GuardOptions = {}) => {
    if (!selected(options).length) return Promise.resolve(true);
    if (confirmationRef.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next = { options, resolve, focus: document.activeElement instanceof HTMLElement ? document.activeElement : null };
      confirmationRef.current = next;
      setConfirmation(next);
    });
  }, [selected]);
  const readRecovery = useCallback(<T,>(id: string) => recoveries.current.get(id) as RecoverySnapshot<T> | undefined, []);
  const removeRecovery = useCallback((id: string, owner?: string) => {
    if (owner && recoveries.current.get(id)?.owner !== owner) return;
    if (recoveries.current.delete(id)) changed();
  }, [changed]);
  const removeRecoveryScope = useCallback((scope: "dashboard" | "settings") => {
    let removed = false;
    for (const id of recoveries.current.keys()) {
      if (id === scope || id.startsWith(`${scope}:`) || scope === "dashboard" && id === "dashboard-dialog") {
        recoveries.current.delete(id); removed = true;
      }
    }
    if (removed) changed();
  }, [changed]);
  const acknowledgeRecovery = useCallback((id: string, owner: string, revision: string | null, compatibleChildrenFrom?: string) => {
    const snapshot = recoveries.current.get(id);
    if (snapshot && snapshot.owner !== owner) return;
    let acknowledged = false;
    if (snapshot) { recoveries.current.set(id, { ...snapshot, revision }); acknowledged = true; }
    if (id === "settings" && compatibleChildrenFrom) {
      recoveries.current.forEach((child, childId) => {
        // Only disjoint, accepted owner writes may advance these projections.
        // Older or previously conflicted drafts still require explicit review.
        if (!/^settings:(?:group-entry$|group-name:|service-form:|bookmark-form:)/.test(childId)
          || child.revision !== compatibleChildrenFrom || child.conflicted) return;
        recoveries.current.set(childId, { ...child, revision }); acknowledged = true;
      });
    }
    if (acknowledged) changed();
  }, [changed]);
  const writeRecovery = useCallback((id: string, snapshot: RecoverySnapshot) => {
    const safe = { revision: snapshot.revision, value: sanitizeRecovery(snapshot.value), dirty: snapshot.dirty, owner: snapshot.owner, conflicted: snapshot.conflicted };
    // Bound memory without evicting a newer edit behind an older copy.
    const serialized = JSON.stringify(safe);
    if (new TextEncoder().encode(serialized).byteLength > MAX_RECOVERY_BYTES) {
      if (recoveries.current.delete(id)) changed();
      return false;
    }
    if (JSON.stringify(recoveries.current.get(id)) === serialized) return true;
    recoveries.current.delete(id);
    recoveries.current.set(id, safe);
    while (recoveries.current.size > MAX_RECOVERIES) recoveries.current.delete(recoveries.current.keys().next().value!);
    changed();
    return true;
  }, [changed]);
  const clear = useCallback(() => {
    confirmationRef.current?.resolve(false);
    confirmationRef.current = null;
    dialog.current?.close();
    setConfirmation(null); setWorking(false);
    recoveries.current.clear();
    sources.current.forEach((source) => source().discard());
    changed();
  }, [changed]);
  const verifyRevision = useCallback(() => {
    if (verification.current) return verification.current;
    const generation = verificationGeneration.current;
    const controller = new AbortController();
    verificationController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    const request = (async (): Promise<RevisionCheck> => {
      try {
        const response = await fetch("/api/settings", { cache: "no-store", signal: controller.signal });
        if (generation !== verificationGeneration.current) {
          await response.body?.cancel().catch(() => undefined);
          return { state: "superseded" };
        }
        if (!mounted.current) return { state: "unavailable" };
        if (response.status === 401 || response.status === 403) {
          clear(); router.replace("/login"); router.refresh();
          return { state: "unauthorized" };
        }
        const revision = response.ok ? response.headers?.get(CONFIG_REVISION_HEADER) : null;
        await response.body?.cancel().catch(() => undefined);
        if (generation !== verificationGeneration.current) return { state: "superseded" };
        return revision ? { state: "ready", revision } : { state: "unavailable" };
      } catch { return { state: generation !== verificationGeneration.current ? "superseded" : "unavailable" }; }
      finally { window.clearTimeout(timeout); }
    })();
    verification.current = request;
    void request.finally(() => {
      if (verification.current === request) verification.current = null;
      if (verificationController.current === controller) verificationController.current = null;
    });
    return request;
  }, [clear, router]);

  const all = selected().map(([, source]) => source());
  const dirty = all.some((source) => source.dirty);
  const saving = all.some((source) => source.saving);
  useLayoutEffect(() => {
    if (!dirty && !saving) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!selected().length) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, saving, selected]);
  useEffect(() => {
    if (!confirmation) return;
    dialog.current?.showModal();
    stay.current?.focus();
  }, [confirmation]);
  useEffect(() => {
    // Traversal itself is not blocked. Cancel a stale app-owned confirmation
    // so it cannot navigate somewhere else after Back/Forward has occurred.
    const onHistoryTraversal = () => { if (confirmationRef.current) finish(false); };
    window.addEventListener("popstate", onHistoryTraversal);
    return () => window.removeEventListener("popstate", onHistoryTraversal);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const retained = recoveries.current;
    const registered = sources.current;
    return () => {
      mounted.current = false;
      verificationController.current?.abort();
      confirmationRef.current?.resolve(false);
      confirmationRef.current = null;
      retained.clear();
      registered.clear();
    };
  }, []);

  function finish(allowed: boolean) {
    const pending = confirmationRef.current;
    confirmationRef.current = null;
    dialog.current?.close();
    setConfirmation(null);
    setWorking(false);
    pending?.resolve(allowed);
    if (!allowed && pending?.focus?.isConnected) pending.focus.focus();
  }
  async function saveAndContinue() {
    if (!confirmation) return;
    setWorking(true);
    // A form save may transfer changes into the dashboard/settings pipeline.
    // Re-read after each confirmed snapshot so later work is never skipped.
    try {
      for (let round = 0; round < MAX_RECOVERIES; round++) {
        if (confirmationRef.current !== confirmation) return;
        const pending = selected(confirmation.options);
        if (!pending.length) { finish(true); return; }
        if (!compatibleWrites(pending.map(([, source]) => source()))) { finish(false); return; }
        const source = pending[0][1]();
        if (source.saving || !source.save || !(await source.save())) {
          if (confirmationRef.current === confirmation) finish(false);
          return;
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    } catch {
      if (confirmationRef.current === confirmation) finish(false);
      return;
    }
    if (confirmationRef.current === confirmation) finish(false);
  }
  const pending = confirmation ? selected(confirmation.options).map(([, source]) => source()) : [];
  const pendingWrite = pending.some((source) => source.saving);
  const compatible = compatibleWrites(pending);
  const canSave = compatible && pending.length > 0 && pending.every((source) => source.save && !source.saving);
  const value = useMemo(() => ({ dirty, saving, revisionCheckGeneration: verificationGeneration.current, register, changed, confirm, clear, readRecovery, writeRecovery, removeRecovery, removeRecoveryScope, acknowledgeRecovery, verifyRevision, beginWrite }),
    // version publishes registrations/dirty changes even when aggregate booleans match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, dirty, saving, register, changed, confirm, clear, readRecovery, writeRecovery, removeRecovery, removeRecoveryScope, acknowledgeRecovery, verifyRevision, beginWrite]);
  return <Context.Provider value={value}>
    {children}
    {confirmation && <dialog ref={dialog} className="service-form-dialog" aria-labelledby="unsaved-changes-title"
      onCancel={(event) => { event.preventDefault(); if (!working) finish(false); }}>
      <div className="service-form-dialog__header"><h2 id="unsaved-changes-title">Unsaved changes</h2></div>
      <div className="service-form__body">
        <p>{pendingWrite ? "A save is still in progress. Wait for it to finish before leaving." : "Keep editing, or discard the unsaved changes before continuing."}</p>
        {!compatible && <p>These drafts cannot be saved together. Stay and save each editor separately; review any draft based on older settings before saving it.</p>}
        <ul>{pending.map((source, index) => <li key={index}>{source.label}</li>)}</ul>
      </div>
      <div className="service-form__actions">
        <button ref={stay} type="button" className="settings-btn" disabled={working} onClick={() => finish(false)}>Stay</button>
        {canSave && <button type="button" className="settings-btn" disabled={working} onClick={() => void saveAndContinue()}>Save &amp; continue</button>}
        <button type="button" className="settings-btn settings-btn--danger" disabled={working || pendingWrite} onClick={() => {
          if (!confirmation.options.deferDiscard) {
            selected(confirmation.options).forEach(([id, source]) => { source().discard(); recoveries.current.delete(id); });
          }
          finish(true);
        }}>Discard and continue</button>
      </div>
    </dialog>}
  </Context.Provider>;
}

export function useUnsavedChanges() { return useContext(Context); }

/** Publishes committed source refs before the browser can navigate or unload. */
export function useUnsavedSource(id: string, source: UnsavedSource) {
  const context = useUnsavedChanges();
  const latest = useRef(source);
  useLayoutEffect(() => { latest.current = source; });
  const register = context?.register;
  const changed = context?.changed;
  const hasSave = Boolean(source.save);
  useLayoutEffect(() => register?.(id, () => ({
    ...latest.current,
    discard: () => {
      const current = latest.current;
      latest.current = { ...current, dirty: false, saving: false };
      current.discard();
      changed?.();
    },
    save: latest.current.save ? async () => {
      const current = latest.current;
      const saved = await current.save!();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (!saved || latest.current.version !== current.version && latest.current.dirty) return false;
      latest.current = { ...latest.current, dirty: false, saving: false };
      changed?.();
      return true;
    } : undefined,
  })), [id, register, changed]);
  useLayoutEffect(() => { changed?.(); }, [changed, source.dirty, source.saving, source.version, source.scope, source.writeRevision, hasSave]);
}

/** Keeps only explicitly projected recovery fields for this protected layout. */
export function useDraftRecovery<T>(id: string, revision: string | null, value: T, retain: boolean,
  restore: (value: T, changedRevision: boolean) => void, dirty = retain) {
  const context = useUnsavedChanges();
  const owner = useId();
  const [snapshot, setSnapshot] = useState(() => context?.readRecovery<T>(id));
  const [recovered, setRecovered] = useState(Boolean(snapshot));
  const [restoring, setRestoring] = useState(Boolean(snapshot));
  const [validating, setValidating] = useState(Boolean(snapshot));
  const [conflict, setConflict] = useState(Boolean(snapshot?.conflicted || snapshot && snapshot.revision !== revision));
  const [available, setAvailable] = useState(true);
  const baselineRevision = useRef(snapshot?.revision ?? revision);
  const mounted = useRef(false);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => {
    // Adopt only this mounted owner's explicitly acknowledged cache baseline
    // before passive publication or sibling-write verification can use it.
    const acknowledged = context?.readRecovery(id);
    if (acknowledged?.owner === owner) baselineRevision.current = acknowledged.revision;
  });
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const restored = useRef(false);
  const verifyRevision = context?.verifyRevision;
  const pendingWrite = context?.saving;
  const revisionCheckGeneration = context?.revisionCheckGeneration;
  useEffect(() => {
    if (!snapshot || !verifyRevision) return;
    if (pendingWrite) { setValidating(true); return; }
    setValidating(true);
    let disposed = false;
    void verifyRevision().then((current) => {
      if (disposed || current.state === "superseded") return;
      if (current.state !== "ready" || current.revision !== baselineRevision.current) setConflict(true);
      setValidating(false);
    });
    return () => { disposed = true; };
  }, [snapshot, verifyRevision, pendingWrite, revisionCheckGeneration]);
  useEffect(() => {
    if (!snapshot || restored.current) return;
    restored.current = true;
    restoreRef.current(snapshot.value, snapshot.revision !== revision);
    setRestoring(false);
  }, [snapshot, revision]);
  const writeRecovery = context?.writeRecovery;
  const removeRecovery = context?.removeRecovery;
  useEffect(() => {
    if (restoring) return;
    if (retain) setAvailable(writeRecovery?.(id, { revision: baselineRevision.current, value, dirty, owner, conflicted: conflict }) ?? true);
    else { baselineRevision.current = revision; removeRecovery?.(id, owner); }
  }, [id, revision, value, retain, dirty, owner, conflict, writeRecovery, removeRecovery, restoring]);
  return {
    recovered,
    validating,
    conflict,
    available,
    dismiss: () => { setRecovered(false); setSnapshot(undefined); setConflict(false); setValidating(false); removeRecovery?.(id, owner); },
    // Only an acknowledged owner write may advance a retained draft baseline.
    acknowledgeRevision: (next: string | null, compatibleChildrenFrom?: string) => {
      if (!mounted.current) return;
      baselineRevision.current = next; context?.acknowledgeRecovery(id, owner, next, compatibleChildrenFrom);
    },
  };
}
