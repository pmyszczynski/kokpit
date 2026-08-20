"use client";

// Edit-mode menu bodies (Work Package B3): the per-service, per-bookmark and
// per-group kebab contents. Each is a thin presentational wrapper over <Kebab>
// that calls back into EditableServiceGrid; all staging goes through the B1
// setters there, so these components hold only ephemeral UI state (rename
// draft, delete confirmation).
import { useState } from "react";
import type { TileFootprint } from "@/layout/grid";
import Kebab from "./Kebab";

function RemoveItem({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [confirm, setConfirm] = useState(false);
  if (confirm) {
    return (
      <div className="kebab-menu__confirm">
        <button
          type="button"
          role="menuitem"
          className="kebab-menu__item kebab-menu__item--danger"
          onClick={onConfirm}
        >
          Confirm remove
        </button>
        <button
          type="button"
          role="menuitem"
          className="kebab-menu__item"
          onClick={() => setConfirm(false)}
        >
          Cancel
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      className="kebab-menu__item kebab-menu__item--danger"
      onClick={() => setConfirm(true)}
    >
      {label}
    </button>
  );
}

export function ServiceTileMenu({
  name,
  footprint,
  supportedFootprints,
  onEdit,
  onFootprint,
  onDuplicate,
  onRemove,
}: {
  name: string;
  footprint?: TileFootprint;
  supportedFootprints?: Array<TileFootprint & { label?: string }>;
  onEdit: () => void;
  onFootprint: (footprint: TileFootprint) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  return (
    <Kebab label={`${name} options`} triggerClassName="tile-kebab--service">
      {(close) => (
        <>
          <button
            type="button"
            role="menuitem"
            className="kebab-menu__item"
            onClick={() => {
              onEdit();
              close();
            }}
          >
            Edit
          </button>

          {supportedFootprints?.length ? (
            <div className="kebab-menu__section">
              <span className="kebab-menu__label">Footprint</span>
              <div className="kebab-size" role="group" aria-label="Tile footprint">
                {supportedFootprints.map((candidate) => {
                  const label = candidate.label
                    ? `${candidate.label} (${candidate.columnSpan}×${candidate.rowSpan})`
                    : `${candidate.columnSpan}×${candidate.rowSpan}`;
                  const active =
                    footprint?.columnSpan === candidate.columnSpan &&
                    footprint?.rowSpan === candidate.rowSpan;
                  return (
                    <button
                      key={`${candidate.columnSpan}x${candidate.rowSpan}`}
                      type="button"
                      className={`kebab-size__btn${active ? " kebab-size__btn--active" : ""}`}
                      aria-pressed={active}
                      aria-label={label}
                      title={label}
                      onClick={() => {
                        onFootprint({
                          columnSpan: candidate.columnSpan,
                          rowSpan: candidate.rowSpan,
                        });
                        close();
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <button
            type="button"
            role="menuitem"
            className="kebab-menu__item"
            onClick={() => {
              onDuplicate();
              close();
            }}
          >
            Duplicate
          </button>
          <RemoveItem
            label="Remove"
            onConfirm={() => {
              onRemove();
              close();
            }}
          />
        </>
      )}
    </Kebab>
  );
}

export function BookmarkTileMenu({
  name,
  onEdit,
  onDuplicate,
  onRemove,
}: {
  name: string;
  onEdit: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  return (
    <Kebab label={`${name} options`} triggerClassName="tile-kebab--bookmark">
      {(close) => (
        <>
          <button
            type="button"
            role="menuitem"
            className="kebab-menu__item"
            onClick={() => {
              onEdit();
              close();
            }}
          >
            Edit
          </button>
          <button
            type="button"
            role="menuitem"
            className="kebab-menu__item"
            onClick={() => {
              onDuplicate();
              close();
            }}
          >
            Duplicate
          </button>
          <RemoveItem
            label="Remove"
            onConfirm={() => {
              onRemove();
              close();
            }}
          />
        </>
      )}
    </Kebab>
  );
}

export function GroupKebab({
  name,
  declared,
  onRename,
  onDelete,
  onAddService,
  onDeclare,
}: {
  name: string;
  declared: boolean;
  /** Returns false when the new name is rejected (duplicate/blank). */
  onRename: (oldName: string, newName: string) => boolean;
  onDelete: () => void;
  onAddService: () => void;
  onDeclare: () => void;
}) {
  const [renameDraft, setRenameDraft] = useState(name);
  const [renameError, setRenameError] = useState<string | null>(null);

  function commitRename(close: () => void) {
    const trimmed = renameDraft.trim();
    if (trimmed === "" || trimmed === name) {
      setRenameDraft(name);
      setRenameError(null);
      return;
    }
    if (onRename(name, trimmed)) {
      setRenameError(null);
      close();
    } else {
      setRenameError("A group with that name already exists.");
    }
  }

  return (
    <Kebab label={`${name} group options`} triggerClassName="group-kebab">
      {(close) => (
        <>
          <div className="kebab-menu__section">
            <span className="kebab-menu__label">Rename</span>
            <div className="kebab-menu__field">
              <input
                type="text"
                className="settings-input"
                aria-label={`Rename group ${name}`}
                value={renameDraft}
                onChange={(e) => {
                  setRenameDraft(e.target.value);
                  setRenameError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename(close);
                  }
                }}
              />
              <button
                type="button"
                className="settings-btn"
                onClick={() => commitRename(close)}
              >
                Apply
              </button>
            </div>
            {renameError && (
              <p
                className="settings-form-hint settings-form-hint--error"
                role="alert"
              >
                {renameError}
              </p>
            )}
          </div>

          <button
            type="button"
            role="menuitem"
            className="kebab-menu__item"
            onClick={() => {
              onAddService();
              close();
            }}
          >
            Add service here
          </button>

          {!declared && (
            <button
              type="button"
              role="menuitem"
              className="kebab-menu__item"
              onClick={() => {
                onDeclare();
                close();
              }}
            >
              Declare group
            </button>
          )}

          {declared && (
            <RemoveItem
              label="Delete group"
              onConfirm={() => {
                onDelete();
                close();
              }}
            />
          )}
        </>
      )}
    </Kebab>
  );
}
