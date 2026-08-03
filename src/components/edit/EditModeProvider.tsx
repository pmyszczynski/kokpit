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
} from "react";
import { useRouter } from "next/navigation";
import type {
  BookmarkGroup,
  Group,
  KokpitConfig,
  Service,
} from "@/config/schema";
import { canonicalJSONString } from "@/config/canonicalJson";
import { CONFIG_REVISION_HEADER } from "@/config/revisionHeader";
import type { ClientSafeSettings } from "@/widgets/clientSafeSettings";
import EditBar from "./EditBar";
import { persistLegacyServices } from "./serviceFormProjection";

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
  pendingEditService: string | null;
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
};

export type EditModeAction =
  | { type: "ENTER_START" }
  | { type: "ENTER_SUCCESS"; config: ClientSafeSettings; revision: string | null }
  | { type: "ENTER_ERROR"; error: string }
  | { type: "DISCARD" }
  | { type: "SET_DRAFT"; draft: ClientSafeSettings }
  | { type: "SAVE_START" }
  | { type: "SAVE_SUCCESS"; revision: string | null }
  | { type: "SAVE_ERROR"; error: string }
  | { type: "CONFLICT"; error: string }
  | { type: "RELOAD_SUCCESS"; config: ClientSafeSettings; revision: string | null }
  | { type: "REQUEST_SERVICE_EDIT"; name: string }
  | { type: "CLEAR_PENDING_EDIT" };

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
        draft: action.config,
        baseline: action.config,
        baseRevision: action.revision,
        status: "idle",
        error: null,
        conflict: false,
      };
    case "REQUEST_SERVICE_EDIT":
      return { ...state, pendingEditService: action.name };
    case "CLEAR_PENDING_EDIT":
      if (state.pendingEditService === null) return state;
      return { ...state, pendingEditService: null };
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
  /** True when the draft differs from the baseline. */
  dirty: boolean;
  /** Number of changed top-level editable keys (edit-bar counter). */
  dirtyCount: number;
  /** Enter edit mode: fetch the config + revision into the draft. */
  enter: () => Promise<void>;
  /** Enter when in view mode, Discard when already editing. */
  toggle: () => void;
  /** Leave edit mode, dropping all staged changes. */
  discard: () => void;
  /** PATCH the changed keys with `If-Match`, then exit + refresh on success. */
  save: () => Promise<void>;
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
  requestServiceEdit: (name: string) => void;
  /** Drop a pending request (after it has been honoured, or is unresolvable). */
  clearPendingEditService: () => void;
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
  children: React.ReactNode;
}

export function EditModeProvider({ canEdit, children }: EditModeProviderProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(editModeReducer, initialEditModeState);

  const enter = useCallback(async () => {
    if (!canEdit) return;
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
    }
  }, [canEdit]);

  const discard = useCallback(() => dispatch({ type: "DISCARD" }), []);

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
      updateDraft(persistLegacyServices(services, state.draft.services, state.draft.service_tiles));
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
    if (!state.draft || !state.baseline) return;
    // Refuse to save while conflicted: the draft is based on a now-stale
    // revision, so committing it would overwrite the external change. The user
    // must Reload (re-fetch) or Discard first.
    if (state.conflict) return;
    const keys = changedKeys(state.draft, state.baseline);
    const draft = state.draft;
    // Nothing changed → just exit without a write.
    if (keys.length === 0) {
      dispatch({ type: "SAVE_SUCCESS", revision: state.baseRevision });
      return;
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
        dispatch({
          type: "CONFLICT",
          error:
            "settings.yaml changed on disk. Reload to review before saving.",
        });
        return;
      }
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      dispatch({ type: "SAVE_SUCCESS", revision: readRevision(res) });
      router.refresh();
    } catch (err) {
      dispatch({
        type: "SAVE_ERROR",
        error: err instanceof Error ? err.message : "Save failed",
      });
    }
  }, [state.draft, state.baseline, state.baseRevision, state.conflict, router]);

  const reload = useCallback(async () => {
    dispatch({ type: "ENTER_START" });
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error(`Failed to reload settings (${res.status})`);
      const config = (await res.json()) as ClientSafeSettings;
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
  }, []);

  const toggle = useCallback(() => {
    if (state.active) discard();
    else void enter();
  }, [state.active, discard, enter]);

  const requestServiceEdit = useCallback(
    (name: string) => {
      if (!canEdit) return;
      dispatch({ type: "REQUEST_SERVICE_EDIT", name });
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

  const value = useMemo<EditModeContextValue>(
    () => ({
      ...state,
      canEdit,
      dirty: keys.length > 0,
      dirtyCount: keys.length,
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
    }),
    [
      state,
      canEdit,
      keys,
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
