"use client";

// Persistent edit-mode bar: dirty/status readout, Discard, Save & exit, and the
// non-blocking conflict notice with Reload. Renders nothing in view mode.
import { useEditMode } from "./EditModeProvider";

export default function EditBar() {
  const {
    active,
    dirty,
    dirtyCount,
    status,
    error,
    conflict,
    discard,
    save,
    reload,
  } = useEditMode();

  if (!active) return null;

  const saving = status === "saving";

  const statusLabel = saving
    ? "Saving…"
    : dirty
      ? `${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"}`
      : "No changes";

  return (
    <div className="edit-bar" role="region" aria-label="Edit mode">
      {conflict && (
        <div className="edit-bar__notice" role="alert">
          <span className="edit-bar__notice-text">
            {error ?? "settings.yaml changed on disk."}
          </span>
          <button
            type="button"
            className="edit-bar__btn"
            onClick={() => void reload()}
          >
            Reload
          </button>
        </div>
      )}
      <div className="edit-bar__row">
        <span
          className={`edit-bar__status${dirty ? " edit-bar__status--dirty" : ""}`}
        >
          <span className="edit-bar__dot" aria-hidden="true" />
          {statusLabel}
        </span>
        {!conflict && status === "error" && error && (
          <span className="edit-bar__error" role="alert">
            {error}
          </span>
        )}
        <div className="edit-bar__actions">
          <button
            type="button"
            className="edit-bar__btn"
            onClick={discard}
            disabled={saving}
          >
            Discard
          </button>
          <button
            type="button"
            className="edit-bar__btn edit-bar__btn--primary"
            onClick={() => void save()}
            // Blocked while conflicted: saving a stale draft would overwrite the
            // external change. Reload (or Discard) is the only way forward.
            disabled={saving || conflict}
            title={
              conflict
                ? "Reload before saving — settings.yaml changed on disk"
                : undefined
            }
          >
            {saving ? "Saving…" : "Save & exit"}
          </button>
        </div>
      </div>
    </div>
  );
}
