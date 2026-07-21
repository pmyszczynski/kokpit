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
import EditBar from "./EditBar";

export type EditModeStatus =
  | "idle"
  | "loading"
  | "saving"
  | "saved"
  | "error";

/** Top-level config keys edit mode can stage and persist. */
export const EDITABLE_KEYS = [
  "services",
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
  draft: KokpitConfig | null;
  /** Snapshot of the config as loaded — the baseline `dirty` is derived from. */
  baseline: KokpitConfig | null;
  /** Revision captured on entry, sent as `If-Match` on save. */
  baseRevision: string | null;
  status: EditModeStatus;
  error: string | null;
  /** True when a save 409'd — the on-disk config moved under us. */
  conflict: boolean;
}

export const initialEditModeState: EditModeState = {
  active: false,
  draft: null,
  baseline: null,
  baseRevision: null,
  status: "idle",
  error: null,
  conflict: false,
};

export type EditModeAction =
  | { type: "ENTER_START" }
  | { type: "ENTER_SUCCESS"; config: KokpitConfig; revision: string | null }
  | { type: "ENTER_ERROR"; error: string }
  | { type: "DISCARD" }
  | { type: "SET_DRAFT"; draft: KokpitConfig }
  | { type: "SAVE_START" }
  | { type: "SAVE_SUCCESS"; revision: string | null }
  | { type: "SAVE_ERROR"; error: string }
  | { type: "CONFLICT"; revision: string | null; error: string }
  | { type: "RELOAD_SUCCESS"; config: KokpitConfig; revision: string | null };

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
      // Keep the draft so the user can Reload (discard) deliberately.
      return {
        ...state,
        status: "error",
        conflict: true,
        error: action.error,
        baseRevision: action.revision ?? state.baseRevision,
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
    default:
      return state;
  }
}

/** Changed top-level editable keys between a draft and its baseline. */
export function changedKeys(
  draft: KokpitConfig | null,
  baseline: KokpitConfig | null
): EditableKey[] {
  if (!draft || !baseline) return [];
  return EDITABLE_KEYS.filter(
    (key) =>
      canonicalJSONString(draft[key]) !== canonicalJSONString(baseline[key])
  );
}

export interface EditModeContextValue extends EditModeState {
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
  updateDraft: (patch: Partial<KokpitConfig>) => void;
  setServices: (services: Service[]) => void;
  setGroups: (groups: Group[] | undefined) => void;
  setBookmarks: (bookmarks: BookmarkGroup[] | undefined) => void;
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
      const config = (await res.json()) as KokpitConfig;
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
    (patch: Partial<KokpitConfig>) => {
      if (!state.draft) return;
      dispatch({ type: "SET_DRAFT", draft: { ...state.draft, ...patch } });
    },
    [state.draft]
  );

  const setServices = useCallback(
    (services: Service[]) => updateDraft({ services }),
    [updateDraft]
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
          revision: readRevision(res),
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
  }, [state.draft, state.baseline, state.baseRevision, router]);

  const reload = useCallback(async () => {
    dispatch({ type: "ENTER_START" });
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error(`Failed to reload settings (${res.status})`);
      const config = (await res.json()) as KokpitConfig;
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
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canEdit, toggle]);

  const keys = useMemo(
    () => changedKeys(state.draft, state.baseline),
    [state.draft, state.baseline]
  );

  const value = useMemo<EditModeContextValue>(
    () => ({
      ...state,
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
    }),
    [
      state,
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
