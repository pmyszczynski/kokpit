"use client";

// Edit-mode "add tile" picker (Work Package B3): a small modal listing what
// can be added — a blank service, a widget-preset service (reusing the Phase A
// serviceEditorPreset tile-type list), or a bookmark group. The chosen kind is
// reported to EditableServiceGrid, which opens the matching form pre-targeted
// at the group the add-flow was launched from.
import { useEffect, useRef } from "react";
import "@/integrations";
import { getWidgetsWithServiceEditorPreset } from "@/widgets";

export type AddChoice =
  | { kind: "service" }
  | { kind: "preset"; preset: string }
  | { kind: "bookmark" };

export default function AddTilePicker({
  targetGroup,
  onPick,
  onClose,
}: {
  targetGroup: string | null;
  onPick: (choice: AddChoice) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const presets = getWidgetsWithServiceEditorPreset();

  function handleClose() {
    dialogRef.current?.close();
  }

  return (
    <dialog
      ref={dialogRef}
      className="service-form-dialog add-tile-picker"
      onClose={onClose}
    >
      <div className="service-form-dialog__header">
        <h2>
          Add tile{targetGroup ? ` to ${targetGroup}` : ""}
        </h2>
        <button
          type="button"
          className="service-form-dialog__close"
          onClick={handleClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="add-tile-picker__body">
        <button
          type="button"
          className="add-tile-picker__option"
          onClick={() => onPick({ kind: "service" })}
        >
          <span className="add-tile-picker__option-name">Blank service</span>
          <span className="add-tile-picker__option-desc">
            A link tile you configure yourself.
          </span>
        </button>
        <button
          type="button"
          className="add-tile-picker__option"
          onClick={() => onPick({ kind: "bookmark" })}
        >
          <span className="add-tile-picker__option-name">Bookmark group</span>
          <span className="add-tile-picker__option-desc">
            A tile holding many plain links.
          </span>
        </button>

        <div className="add-tile-picker__section">Integrations</div>
        <div className="add-tile-picker__presets">
          {presets.map((w) => (
            <button
              key={w.id}
              type="button"
              className="add-tile-picker__preset"
              onClick={() => onPick({ kind: "preset", preset: w.id })}
            >
              {w.name}
            </button>
          ))}
        </div>
      </div>
    </dialog>
  );
}
