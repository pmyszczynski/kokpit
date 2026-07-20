"use client";

import { useState } from "react";
import type { Group } from "@/config/schema";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface GroupsTabProps {
  groups: Group[];
  /** Group names referenced by services/bookmarks but not declared in `groups:`. */
  undeclaredGroups: string[];
  ungrouped: "first" | "last";
  saveStatus: SaveStatus;
  onReorder: (from: number, to: number) => void;
  onRename: (oldName: string, newName: string) => void;
  onToggleCollapsed: (index: number) => void;
  onColumnsChange: (index: number, columns: number | undefined) => void;
  onDelete: (index: number) => void;
  onDeclare: (name: string) => void;
  onAdd: (name: string) => void;
  onUngroupedChange: (value: "first" | "last") => void;
  onSave: () => void;
}

function GroupRow({
  group,
  index,
  isFirst,
  isLast,
  onReorder,
  onRename,
  onToggleCollapsed,
  onColumnsChange,
  onDelete,
}: {
  group: Group;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onReorder: (from: number, to: number) => void;
  onRename: (oldName: string, newName: string) => void;
  onToggleCollapsed: (index: number) => void;
  onColumnsChange: (index: number, columns: number | undefined) => void;
  onDelete: (index: number) => void;
}) {
  const [nameDraft, setNameDraft] = useState(group.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function commitRename() {
    const trimmed = nameDraft.trim();
    if (trimmed === "" || trimmed === group.name) {
      setNameDraft(group.name);
      return;
    }
    onRename(group.name, trimmed);
  }

  return (
    <div className="groups-row">
      <div className="groups-row__reorder">
        <button
          type="button"
          className="settings-icon-btn"
          aria-label={`Move ${group.name} up`}
          disabled={isFirst}
          onClick={() => onReorder(index, index - 1)}
        >
          ▲
        </button>
        <button
          type="button"
          className="settings-icon-btn"
          aria-label={`Move ${group.name} down`}
          disabled={isLast}
          onClick={() => onReorder(index, index + 1)}
        >
          ▼
        </button>
      </div>

      <input
        type="text"
        className="settings-input"
        aria-label={`Group name for ${group.name}`}
        value={nameDraft}
        onChange={(e) => setNameDraft(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitRename();
          }
        }}
      />

      <label className="groups-row__collapsed">
        <input
          type="checkbox"
          checked={group.collapsed ?? false}
          onChange={() => onToggleCollapsed(index)}
        />
        Collapsed by default
      </label>

      <input
        type="number"
        min={1}
        max={12}
        className="settings-input settings-input--narrow"
        aria-label={`Columns for ${group.name}`}
        placeholder="Inherit"
        value={group.columns ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          const n = parseInt(v, 10);
          // Clamp to the input's own declared range [1, 12] so a typed value
          // (which the number input doesn't clamp) can't set absurd columns.
          onColumnsChange(
            index,
            v === "" || isNaN(n) || n < 1 ? undefined : Math.min(n, 12)
          );
        }}
      />

      {confirmDelete ? (
        <span className="groups-row__actions">
          <button
            type="button"
            className="settings-btn settings-btn--danger"
            onClick={() => onDelete(index)}
          >
            Confirm
          </button>
          <button
            type="button"
            className="settings-btn"
            onClick={() => setConfirmDelete(false)}
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="settings-btn settings-btn--danger"
          onClick={() => setConfirmDelete(true)}
        >
          Delete
        </button>
      )}
    </div>
  );
}

export default function GroupsTab({
  groups,
  undeclaredGroups,
  ungrouped,
  saveStatus,
  onReorder,
  onRename,
  onToggleCollapsed,
  onColumnsChange,
  onDelete,
  onDeclare,
  onAdd,
  onUngroupedChange,
  onSave,
}: GroupsTabProps) {
  const [newGroup, setNewGroup] = useState("");

  function handleAdd() {
    const trimmed = newGroup.trim();
    if (trimmed === "") return;
    onAdd(trimmed);
    setNewGroup("");
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Groups</h2>

      {groups.length === 0 ? (
        <p className="settings-empty">No groups declared yet.</p>
      ) : (
        <div className="groups-list">
          {groups.map((g, i) => (
            <GroupRow
              key={g.name}
              group={g}
              index={i}
              isFirst={i === 0}
              isLast={i === groups.length - 1}
              onReorder={onReorder}
              onRename={onRename}
              onToggleCollapsed={onToggleCollapsed}
              onColumnsChange={onColumnsChange}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      {undeclaredGroups.length > 0 && (
        <div className="groups-undeclared">
          <p className="settings-hint">
            Referenced by services or bookmarks but not declared — declare them to
            make them orderable.
          </p>
          {undeclaredGroups.map((name) => (
            <div key={name} className="groups-row groups-row--undeclared">
              <span className="groups-undeclared__name">{name}</span>
              <button
                type="button"
                className="settings-btn"
                onClick={() => onDeclare(name)}
              >
                Declare
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="settings-form-row groups-add">
        <input
          type="text"
          className="settings-input"
          aria-label="New group name"
          placeholder="New group name"
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <button
          type="button"
          className="settings-btn"
          onClick={handleAdd}
          disabled={newGroup.trim() === ""}
        >
          + Add group
        </button>
      </div>

      <div className="settings-form-row">
        <label htmlFor="groups-ungrouped">Ungrouped position</label>
        <select
          id="groups-ungrouped"
          className="settings-input settings-input--narrow"
          value={ungrouped}
          onChange={(e) => onUngroupedChange(e.target.value as "first" | "last")}
        >
          <option value="first">First</option>
          <option value="last">Last</option>
        </select>
        <span className="settings-hint">
          Where the implicit &ldquo;ungrouped&rdquo; services section appears.
        </span>
      </div>

      <div className="settings-actions settings-actions--spaced">
        <button
          className="settings-save-btn"
          onClick={onSave}
          disabled={saveStatus === "saving"}
        >
          {saveStatus === "saving"
            ? "Saving…"
            : saveStatus === "saved"
              ? "Saved ✓"
              : saveStatus === "error"
                ? "Error — Retry"
                : "Save"}
        </button>
      </div>
    </section>
  );
}
