"use client";

// Client-side "spine" of dashboard edit mode (Work Package B1).
//
// Owns a staged draft of the whole config, fetched from GET /api/settings on
// entry, and commits it with a single PATCH on save. View mode is untouched —
// this only holds state and exposes actions; the visual swap lives in
// DashboardSurface, and the mutators here (setServices/setGroups/setBookmarks)
// are what B2 (drag) and B3 (kebab/add menus) will call to stage changes.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { useRouter } from "next/navigation";
import type {
  BookmarkGroup,
  Group,
  KokpitConfig,
  Service,
} from "@/config/schema";
import { canonicalJSONString } from "@/config/canonicalJson";
import { useConfigurationSync } from "../ConfigurationSyncProvider";
import { CONFIG_REVISION_HEADER } from "@/config/revisionHeader";
import type { ClientSafeSettings } from "@/widgets/clientSafeSettings";
import EditBar from "./EditBar";
import { persistLegacyServices } from "./serviceFormProjection";
import { useUnsavedChanges, useUnsavedSource } from "../unsaved/UnsavedChangesProvider";

export type EditModeStatus =
  | "idle"
  | "loading"
  | "saving"
  | "saved"
  | "error";

/** Top-level config keys edit mode can stage and persist. */
export const EDITABLE_KEYS = [
  "services",
  "service_tiles",
  "groups",
  "bookmarks",
  "appearance",
  "layout",
] as const;
export type EditableKey = (typeof EDITABLE_KEYS)[number];

export interface EditModeState {
  /** True while the dashboard is rendered from the draft. */
  active: boolean;
  /** The staged config; null in view mode. */
  draft: ClientSafeSettings | null;
  /** Snapshot of the config as loaded — the baseline `dirty` is derived from. */
  baseline: ClientSafeSettings | null;
  /** Revision captured on entry, sent as `If-Match` on save. */
  baseRevision: string | null;
  status: EditModeStatus;
  error: string | null;
  /** True when a save 409'd — the on-disk config moved under us. */
  conflict: boolean;
  /**
   * Service whose edit dialog should open as soon as the edit grid mounts.
   * Set from view mode (the broken-widget badge) where the ServiceForm dialog
   * does not exist yet; EditableServiceGrid consumes it and clears it.
   */
  pendingEditService: { serviceId?: string; tileId?: string; name: string } | string | null;
  /** One-shot view-mode add request, consumed after the edit grid mounts. */
  pendingAddTile: "service" | "picker" | null;
}

export const initialEditModeState: EditModeState = {
  active: false,
  draft: null,
  baseline: null,
  baseRevision: null,
  status: "idle",
  error: null,
  conflict: false,
  pendingEditService: null,
  pendingAddTile: null,
};

export type EditModeAction =
  | { type: "ENTER_START" }
  | { type: "ENTER_SUCCESS"; config: ClientSafeSettings; revision: string | null }
  | { type: "ENTER_ERROR"; error: string }
  | { type: "DISCARD" }
  | { type: "SET_DRAFT"; draft: ClientSafeSettings }
  | { type: "SAVE_START" }
  | { type: "SAVE_SUCCESS"; revision: string | null; submitted?: ClientSafeSettings }
  | { type: "SAVE_ERROR"; error: string }
  | { type: "CONFLICT"; error: string }
  | { type: "RELOAD_SUCCESS"; config: ClientSafeSettings; revision: string | null }
  | { type: "REQUEST_SERVICE_EDIT"; request?: { serviceId?: string; tileId?: string; name: string }; name?: string }
  | { type: "CLEAR_PENDING_EDIT" }
  | { type: "REQUEST_TILE_ADD"; kind: "service" | "picker" }
  | { type: "CLEAR_PENDING_ADD" };

export function editModeReducer(
  state: EditModeState,
  action: EditModeAction
): EditModeState {
  switch (action.type) {
    case "ENTER_START":
      return { ...state, status: "loading", error: null, conflict: false };
    case "ENTER_SUCCESS":
      return {
        active: true,
        draft: action.config,
        baseline: action.config,
        baseRevision: action.revision,
        status: "idle",
        error: null,
        conflict: false,
        // Carried across the entry round-trip: REQUEST_SERVICE_EDIT is
        // dispatched from view mode *before* enter() resolves, and this case
        // builds a fresh state object rather than spreading.
        pendingEditService: state.pendingEditService,
        pendingAddTile: state.pendingAddTile,
      };
    case "ENTER_ERROR":
      return { ...initialEditModeState, status: "error", error: action.error };
    case "DISCARD":
      return { ...initialEditModeState };
    case "SET_DRAFT":
      if (!state.active) return state;
      return { ...state, draft: action.draft };
    case "SAVE_START":
      return { ...state, status: "saving", error: null, conflict: false };
    case "SAVE_SUCCESS":
      if (action.submitted && changedKeys(state.draft, action.submitted).length > 0) {
        return { ...state, baseline: action.submitted, baseRevision: action.revision, status: "idle", error: null };
      }
      // Committed → leave edit mode. baseRevision is advanced for completeness
      // even though the draft is dropped on exit.
      return {
        ...initialEditModeState,
        status: "saved",
        baseRevision: action.revision,
      };
    case "SAVE_ERROR":
      return { ...state, status: "error", error: action.error };
    case "CONFLICT":
      // Keep the draft AND the original baseRevision. Advancing baseRevision to
      // the server's value here would let a re-save send the stale draft with a
      // fresh valid If-Match, silently overwriting the external change. By
      // keeping the stale baseRevision, any re-save re-conflicts (409s) until
      // the user explicitly Reloads (re-fetches a fresh revision) or Discards.
      return {
        ...state,
        status: "error",
        conflict: true,
        error: action.error,
      };
    case "RELOAD_SUCCESS":
      return {
        ...state,
        active: true,
        draft: action.config,
        baseline: action.config,
        baseRevision: action.revision,
        status: "idle",
        error: null,
        conflict: false,
      };
    case "REQUEST_SERVICE_EDIT":
      return { ...state, pendingEditService: action.request ?? (action.name ? { name: action.name } : null) };
    case "CLEAR_PENDING_EDIT":
      if (state.pendingEditService === null) return state;
      return { ...state, pendingEditService: null };
    case "REQUEST_TILE_ADD":
      // Keep the first request when rapid activations are batched together.
      return state.pendingAddTile ? state : { ...state, pendingAddTile: action.kind };
    case "CLEAR_PENDING_ADD":
      return state.pendingAddTile === null ? state : { ...state, pendingAddTile: null };
    default:
      return state;
  }
}

/** Changed top-level editable keys between a draft and its baseline. */
export function changedKeys(
  draft: ClientSafeSettings | null,
  baseline: ClientSafeSettings | null
): EditableKey[] {
  if (!draft || !baseline) return [];
  return EDITABLE_KEYS.filter(
    (key) =>
      canonicalJSONString(draft[key]) !== canonicalJSONString(baseline[key])
  );
}

export interface EditModeContextValue extends EditModeState {
  /** Whether the current viewer may edit (mirrors the provider prop). */
  canEdit: boolean;
  /** Whether the server permits caller-supplied widget connection tests. */
  connectionTestingEnabled: boolean;
  /** True when the draft differs from the baseline. */
  dirty: boolean;
  /** Number of changed top-level editable keys (edit-bar counter). */
  dirtyCount: number;
  /** Changes after explicit discard/reload to close stale dashboard dialogs. */
  recoveryResetVersion: number;
  /** Enter edit mode: fetch the config + revision into the draft. */
  enter: () => Promise<void>;
  /** Enter when in view mode, Discard when already editing. */
  toggle: () => void;
  /** Leave edit mode, dropping all staged changes. */
  discard: () => void;
  /** PATCH the changed keys with `If-Match`, then exit + refresh on success. */
  save: () => Promise<boolean>;
  /** Re-fetch the draft + revision, discarding local changes (conflict path). */
  reload: () => Promise<void>;
  /** Replace the whole draft (low-level; prefer the typed setters below). */
  updateDraft: (patch: Partial<ClientSafeSettings>) => void;
  setServices: (services: Service[]) => void;
  setGroups: (groups: Group[] | undefined) => void;
  setBookmarks: (bookmarks: BookmarkGroup[] | undefined) => void;
  /**
   * Ask for a service's edit dialog. Entering edit mode when needed, since the
   * dialog only exists inside EditableServiceGrid — the request is parked in
   * `pendingEditService` until that grid mounts and picks it up.
   */
  requestServiceEdit: (request: { serviceId?: string; tileId?: string; name: string } | string) => void;
  /** Drop a pending request (after it has been honoured, or is unresolvable). */
  clearPendingEditService: () => void;
  requestTileAdd: (kind: "service" | "picker") => void;
  clearPendingTileAdd: () => void;
}

const EditModeContext = createContext<EditModeContextValue | null>(null);

function readRevision(res: Response): string | null {
  return res.headers.get(CONFIG_REVISION_HEADER);
}

export interface EditModeProviderProps {
  /**
   * Whether the current viewer may edit (mirrors the /api/settings guard). The
   * protected layout only renders for authed/allowed viewers, so this is `true`
   * there; kept as a prop so entry can be gated without a server round-trip.
   */
  canEdit: boolean;
  /** Whether the server permits caller-supplied widget connection tests. */
  connectionTestingEnabled: boolean;
  children: React.ReactNode;
}

export function EditModeProvider({
  canEdit: serverCanEdit,
  connectionTestingEnabled,
  children,
}: EditModeProviderProps) {
  const router = useRouter();
  const unsaved = useUnsavedChanges();
  const sync = useConfigurationSync();
  const canEdit = serverCanEdit && (!sync || sync.available && sync.editable);
  const removeRecoveryScope = unsaved?.removeRecoveryScope;
  const [state, dispatch] = useReducer(editModeReducer, initialEditModeState);
  const enteringRef = useRef(false);
  const [recoveryResetVersion, resetRecovery] = useReducer((version: number) => version + 1, 0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const externalConflict = Boolean(state.active && sync?.stale(state.baseRevision));
  const resetDashboardRecovery = useCallback(() => {
    removeRecoveryScope?.("dashboard");
    resetRecovery();
  }, [removeRecoveryScope]);

  const enter = useCallback(async () => {
    if (!canEdit || enteringRef.current) return;
    enteringRef.current = true;
    dispatch({ type: "ENTER_START" });
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
      const config = (await res.json()) as ClientSafeSettings;
      dispatch({ type: "ENTER_SUCCESS", config, revision: readRevision(res) });
    } catch (err) {
      dispatch({
        type: "ENTER_ERROR",
        error: err instanceof Error ? err.message : "Failed to enter edit mode",
      });
    } finally {
      enteringRef.current = false;
    }
  }, [canEdit]);

  const discard = useCallback(() => {
    resetDashboardRecovery();
    dispatch({ type: "DISCARD" });
  }, [resetDashboardRecovery]);

  const updateDraft = useCallback(
    (patch: Partial<ClientSafeSettings>) => {
      if (!state.draft) return;
      dispatch({ type: "SET_DRAFT", draft: { ...state.draft, ...patch } });
    },
    [state.draft]
  );

  const setServices = useCallback(
    (services: Service[]) => {
      if (!state.draft) return;
      updateDraft(persistLegacyServices(
        services,
        state.draft.services,
        state.draft.service_tiles,
        {
          preservePreviousServiceOrder: true,
          preserveUnrepresentedCatalogServices: true,
        }
      ));
    },
    [state.draft, updateDraft]
  );
  const setGroups = useCallback(
    (groups: Group[] | undefined) => updateDraft({ groups }),
    [updateDraft]
  );
  const setBookmarks = useCallback(
    (bookmarks: BookmarkGroup[] | undefined) => updateDraft({ bookmarks }),
    [updateDraft]
  );

  const save = useCallback(async () => {
    if (!state.draft || !state.baseline || state.status === "saving") return false;
    // Refuse to save while conflicted: the draft is based on a now-stale
    // revision, so committing it would overwrite the external change. The user
    // must Reload (re-fetch) or Discard first.
    if (state.conflict || externalConflict || !canEdit) return false;
    const keys = changedKeys(state.draft, state.baseline);
    const draft = state.draft;
    // Nothing changed → just exit without a write.
    if (keys.length === 0) {
      dispatch({ type: "SAVE_SUCCESS", revision: state.baseRevision });
      return true;
    }
    const body: Partial<KokpitConfig> = {};
    for (const key of keys) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (body as any)[key] = draft[key];
    }
    dispatch({ type: "SAVE_START" });
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(state.baseRevision ? { "If-Match": state.baseRevision } : {}),
        },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        const payload: unknown = await res.json().catch(() => null);
        const code = payload && typeof payload === "object" && "code" in payload
          && typeof payload.code === "string" ? payload.code : null;
        if (code === "revision_mismatch") {
          dispatch({
            type: "CONFLICT",
            error:
              "settings.yaml changed on disk. Reload to review before saving.",
          });
        } else {
          const detail = payload && typeof payload === "object" && "error" in payload
            && typeof payload.error === "string" ? payload.error : "Save temporarily unavailable";
          dispatch({ type: "SAVE_ERROR", error: detail });
        }
        return false;
      }
      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        const detail = payload && typeof payload === "object" && "error" in payload
          && typeof payload.error === "string" ? payload.error : null;
        throw new Error(`Save failed (${res.status})${detail ? `: ${detail}` : ""}`);
      }
      const unchanged = changedKeys(stateRef.current.draft, draft).length === 0;
      sync?.acknowledge(readRevision(res));
      dispatch({ type: "SAVE_SUCCESS", revision: readRevision(res), submitted: draft });
      router.refresh();
      return unchanged;
    } catch (err) {
      dispatch({
        type: "SAVE_ERROR",
        error: err instanceof Error ? err.message : "Save failed",
      });
      return false;
    }
  }, [state.draft, state.baseline, state.baseRevision, state.conflict, state.status, router, sync, externalConflict, canEdit]);

  const reload = useCallback(async () => {
    if (unsaved && !(await unsaved.confirm({ scope: "dashboard" }))) return;
    dispatch({ type: "ENTER_START" });
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error(`Failed to reload settings (${res.status})`);
      const config = (await res.json()) as ClientSafeSettings;
      resetDashboardRecovery();
      dispatch({
        type: "RELOAD_SUCCESS",
        config,
        revision: readRevision(res),
      });
    } catch (err) {
      dispatch({
        type: "SAVE_ERROR",
        error: err instanceof Error ? err.message : "Failed to reload",
      });
    }
  }, [unsaved, resetDashboardRecovery]);

  useEffect(() => {
    if (!externalConflict || !canEdit || unsaved?.dirty || state.status !== "idle") return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/settings", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const config = await response.json() as ClientSafeSettings;
        if (controller.signal.aborted || changedKeys(stateRef.current.draft, stateRef.current.baseline).length) return;
        const next = readRevision(response);
        if (sync?.stale(next)) { sync.recheck(); return; }
        dispatch({ type: "RELOAD_SUCCESS", config, revision: next });
      } catch { /* The stale notice keeps writes blocked until retry/reload. */ }
    })();
    return () => controller.abort();
  }, [externalConflict, canEdit, unsaved?.dirty, state.status, sync]);

  const toggle = useCallback(() => {
    if (state.active) {
      if (unsaved) void unsaved.confirm({ scope: "dashboard" }).then((allowed) => { if (allowed) discard(); });
      else discard();
    }
    else void enter();
  }, [state.active, discard, enter, unsaved]);

  const requestServiceEdit = useCallback(
    (request: { serviceId?: string; tileId?: string; name: string } | string) => {
      if (!canEdit) return;
      dispatch({ type: "REQUEST_SERVICE_EDIT", request: typeof request === "string" ? { name: request } : request });
      // From view mode the edit grid (and with it the dialog) does not exist
      // yet, so entry has to happen too. A failed entry resets to
      // initialEditModeState via ENTER_ERROR, which drops the pending name —
      // the right outcome: no edit mode, nothing to open. Also guard against
      // a duplicate entry request: a double-click on the badge (or a click
      // while entry is already in flight) would otherwise fire a second
      // GET /api/settings before the first one resolves.
      if (!state.active && state.status !== "loading") void enter();
    },
    [canEdit, state.active, state.status, enter]
  );

  const clearPendingEditService = useCallback(
    () => dispatch({ type: "CLEAR_PENDING_EDIT" }),
    []
  );

  const requestTileAdd = useCallback((kind: "service" | "picker") => {
    if (!canEdit || state.status === "loading" || state.status === "saving" || state.pendingAddTile) return;
    dispatch({ type: "REQUEST_TILE_ADD", kind });
    if (!state.active) void enter();
  }, [canEdit, state.status, state.pendingAddTile, state.active, enter]);

  const clearPendingTileAdd = useCallback(() => dispatch({ type: "CLEAR_PENDING_ADD" }), []);

  // First global hotkey in the app: Mod+E toggles edit mode. Ignored while the
  // user is typing into a field so it never eats an in-form keystroke.
  useEffect(() => {
    if (!canEdit) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key.toLowerCase() !== "e") return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      e.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKeyDown);
    // Hydration edge for the hotkey: this passive effect runs *after* paint, so
    // a visible navbar/tile does not prove Mod+E is live yet — pressing before
    // this runs is a lost no-op (an e2e flake). Expose a marker the instant the
    // listener is attached so tests can wait for the real "ready" edge.
    document.documentElement.dataset.editHotkeyReady = "true";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      delete document.documentElement.dataset.editHotkeyReady;
    };
  }, [canEdit, toggle]);

  const keys = useMemo(
    () => changedKeys(state.draft, state.baseline),
    [state.draft, state.baseline]
  );
  const draftVersion = useMemo(() => canonicalJSONString(state.draft), [state.draft]);
  useUnsavedSource("dashboard", {
    label: "Dashboard layout", dirty: keys.length > 0, saving: state.status === "saving",
    survivesNavigation: true,
    scope: "dashboard",
    writeRevision: state.baseRevision,
    priority: 20,
    version: draftVersion,
    discard,
    save: state.conflict || externalConflict || !canEdit ? undefined : save,
  });

  const value = useMemo<EditModeContextValue>(
    () => ({
      ...state,
      conflict: state.conflict || externalConflict,
      error: externalConflict ? "settings.yaml changed on disk. Reload to review before saving." : state.error,
      canEdit,
      connectionTestingEnabled,
      dirty: keys.length > 0,
      dirtyCount: keys.length,
      recoveryResetVersion,
      enter,
      toggle,
      discard,
      save,
      reload,
      updateDraft,
      setServices,
      setGroups,
      setBookmarks,
      requestServiceEdit,
      clearPendingEditService,
      requestTileAdd,
      clearPendingTileAdd,
    }),
    [
      state,
      externalConflict,
      canEdit,
      connectionTestingEnabled,
      keys,
      recoveryResetVersion,
      enter,
      toggle,
      discard,
      save,
      reload,
      updateDraft,
      setServices,
      setGroups,
      setBookmarks,
      requestServiceEdit,
      clearPendingEditService,
      requestTileAdd,
      clearPendingTileAdd,
    ]
  );

  return (
    <EditModeContext.Provider value={value}>
      {children}
      <EditBar />
    </EditModeContext.Provider>
  );
}

/** Access edit-mode state + actions. Throws outside an EditModeProvider. */
export function useEditMode(): EditModeContextValue {
  const ctx = useContext(EditModeContext);
  if (!ctx) {
    throw new Error("useEditMode must be used within an EditModeProvider");
  }
  return ctx;
}

/**
 * Same as useEditMode, but returns null instead of throwing when there is no
 * provider. For components that live in both the dashboard tree and standalone
 * (e.g. ServiceTile, which is rendered on its own in unit tests) and only want
 * edit affordances when edit mode is actually available.
 */
export function useEditModeOptional(): EditModeContextValue | null {
  return useContext(EditModeContext);
}
