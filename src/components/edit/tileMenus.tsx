"use client";

// Edit-mode menu bodies (Work Package B3): the per-service, per-bookmark and
// per-group kebab contents. Each is a thin presentational wrapper over <Kebab>
// that calls back into EditableServiceGrid; all staging goes through the B1
// setters there, so these components hold only ephemeral UI state (rename
// draft, delete confirmation).
import { useState } from "react";
import type { Size } from "@/config/schema";
import { sizeSatisfies } from "@/config";
import { SIZE_ORDER, sizeLabel } from "../settingsSizeOptions";
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
  size,
  minSize,
  onEdit,
  onSize,
  onDuplicate,
  onRemove,
}: {
  name: string;
  size: Size;
  minSize?: Size;
  onEdit: () => void;
  onSize: (size: Size) => void;
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

          <div className="kebab-menu__section">
            <span className="kebab-menu__label">Size</span>
            <div className="kebab-size" role="group" aria-label="Tile size">
              {SIZE_ORDER.map((s) => {
                const disabled = minSize ? !sizeSatisfies(s, minSize) : false;
                return (
                  <button
                    key={s}
                    type="button"
                    className={`kebab-size__btn${
                      s === size ? " kebab-size__btn--active" : ""
                    }`}
                    aria-pressed={s === size}
                    aria-label={sizeLabel(s)}
                    title={
                      sizeLabel(s) + (disabled ? " — too small for this widget" : "")
                    }
                    disabled={disabled}
                    onClick={() => {
                      onSize(s);
                      close();
                    }}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                );
              })}
            </div>
          </div>

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
  columns,
  onRename,
  onColumns,
  onDelete,
  onAddService,
  onDeclare,
}: {
  name: string;
  declared: boolean;
  columns?: number;
  /** Returns false when the new name is rejected (duplicate/blank). */
  onRename: (oldName: string, newName: string) => boolean;
  onColumns: (columns: number | undefined) => void;
  onDelete: () => void;
  onAddService: () => void;
  onDeclare: () => void;
}) {
  const [renameDraft, setRenameDraft] = useState(name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [columnsDraft, setColumnsDraft] = useState(
    columns != null ? String(columns) : ""
  );

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

  function commitColumns(close: () => void) {
    const trimmed = columnsDraft.trim();
    if (trimmed === "") {
      onColumns(undefined);
    } else {
      const n = parseInt(trimmed, 10);
      onColumns(isNaN(n) || n < 1 ? undefined : Math.min(n, 12));
    }
    close();
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

          {declared && (
            <div className="kebab-menu__section">
              <span className="kebab-menu__label">Columns</span>
              <div className="kebab-menu__field">
                <input
                  type="number"
                  min={1}
                  max={12}
                  className="settings-input settings-input--narrow"
                  aria-label={`Columns for ${name}`}
                  placeholder="Inherit"
                  value={columnsDraft}
                  onChange={(e) => setColumnsDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitColumns(close);
                    }
                  }}
                />
                <button
                  type="button"
                  className="settings-btn"
                  onClick={() => commitColumns(close)}
                >
                  Apply
                </button>
              </div>
            </div>
          )}

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
