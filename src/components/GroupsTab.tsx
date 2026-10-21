"use client";

import { useId, useRef, useState } from "react";
import type { Group } from "@/config/schema";
import { useConfigurationSync } from "./ConfigurationSyncProvider";
import { useDraftRecovery, useUnsavedSource } from "./unsaved/UnsavedChangesProvider";

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
  onDelete: (index: number) => void;
  onDeclare: (name: string) => void;
  onAdd: (name: string) => void;
  onUngroupedChange: (value: "first" | "last") => void;
  onSave: () => void;
  disabled?: boolean;
  baselineRevision?: string | null;
}

function GroupRow({
  group,
  groupNames,
  index,
  isFirst,
  isLast,
  onReorder,
  onRename,
  onToggleCollapsed,
  onDelete,
  baselineRevision,
}: {
  group: Group;
  groupNames: string[];
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onReorder: (from: number, to: number) => void;
  onRename: (oldName: string, newName: string) => void;
  onToggleCollapsed: (index: number) => void;
  onDelete: (index: number) => void;
  baselineRevision?: string | null;
}) {
  const [nameDraft, setNameDraft] = useState(group.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameErrorId = useId();
  const [recoveryConflict, setRecoveryConflict] = useState(false);
  const sourceId = `settings:group-name:${group.name}`;
  const dirty = nameDraft.trim() !== group.name.trim();
  const sync = useConfigurationSync();
  const sourceRevision = useRef(baselineRevision);
  if (!dirty) sourceRevision.current = baselineRevision;
  const syncBlocked = Boolean(sync && (!sync.available || !sync.editable || sync.stale(sourceRevision.current)));
  const recovery = useDraftRecovery(sourceId, baselineRevision ?? null, nameDraft, dirty,
    (saved, changed) => { setNameDraft(saved); setRecoveryConflict(changed); });
  useUnsavedSource(sourceId, {
    label: "Group name", dirty, scope: "settings", version: nameDraft.trim(),
    priority: 1,
    discard: () => { setNameDraft(group.name); setNameError(null); setRecoveryConflict(false); recovery.dismiss(); },
    save: syncBlocked || recoveryConflict || recovery.validating || recovery.conflict || !nameDraft.trim() ? undefined : async () => commitRename(),
  });

  function commitRename(): boolean {
    if (syncBlocked || recoveryConflict || recovery.validating || recovery.conflict) return false;
    const trimmed = nameDraft.trim();
    if (trimmed === "" || trimmed === group.name.trim()) {
      setNameDraft(group.name);
      setNameError(null);
      return trimmed !== "";
    }
    const key = trimmed.toLowerCase();
    if (key !== group.name.trim().toLowerCase()
      && groupNames.some((name) => name.trim().toLowerCase() === key)) {
      setNameError("A group with this name already exists.");
      return false;
    }
    onRename(group.name, trimmed);
    setNameError(null);
    recovery.dismiss();
    return true;
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
        aria-invalid={nameError ? true : undefined}
        aria-describedby={nameError ? nameErrorId : undefined}
        onChange={(e) => { setNameDraft(e.target.value); setNameError(null); }}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitRename();
          }
        }}
      />
      {nameError && <span id={nameErrorId} role="alert" className="settings-hint">{nameError}</span>}
      {((syncBlocked && dirty) || recoveryConflict || recovery.conflict) && <span role="alert" className="settings-hint">{sync?.available && !sync.editable
        ? "Settings are read-only because settings.yaml requires migration. Update the file to schema version 2, then retry. "
        : "Settings changed or could not be verified. Discard this draft and reload the configuration before editing. "}<button type="button" className="settings-btn" onClick={() => {
        setNameDraft(group.name); setNameError(null); setRecoveryConflict(false); recovery.dismiss();
      }}>{recovery.recovered ? "Discard recovered name" : "Discard group name draft"}</button></span>}

      <label className="groups-row__collapsed">
        <input
          type="checkbox"
          checked={group.collapsed ?? false}
          onChange={() => onToggleCollapsed(index)}
        />
        Collapsed by default
      </label>

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
  onDelete,
  onDeclare,
  onAdd,
  onUngroupedChange,
  onSave,
  disabled = false,
  baselineRevision = null,
}: GroupsTabProps) {
  const [newGroup, setNewGroup] = useState("");
  const sync = useConfigurationSync();
  const sourceRevision = useRef(baselineRevision);
  if (!newGroup.trim()) sourceRevision.current = baselineRevision;
  const syncBlocked = Boolean(sync && (!sync.available || !sync.editable || sync.stale(sourceRevision.current)));
  const [entryError, setEntryError] = useState<string | null>(null);
  const recovery = useDraftRecovery("settings:group-entry", baselineRevision, newGroup, Boolean(newGroup.trim()),
    (saved) => setNewGroup(saved));
  useUnsavedSource("settings:group-entry", {
    label: "New group name", dirty: Boolean(newGroup.trim()), scope: "settings", version: newGroup.trim(),
    priority: 1,
    discard: () => { setNewGroup(""); recovery.dismiss(); },
    save: syncBlocked || recovery.validating || recovery.conflict ? undefined : async () => handleAdd(),
  });

  function handleAdd() {
    if (syncBlocked || recovery.validating || recovery.conflict) return false;
    const trimmed = newGroup.trim();
    if (trimmed === "") return false;
    if (groups.some((group) => group.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      setEntryError("A group with this name already exists."); return false;
    }
    onAdd(trimmed);
    setNewGroup("");
    recovery.dismiss(); setEntryError(null);
    return true;
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Groups</h2>
      {recovery.recovered && <p role="status" className="settings-hint">Recovered an unsaved group name. Review before adding.</p>}
      {((syncBlocked && Boolean(newGroup.trim())) || recovery.conflict) && <p role="alert" className="settings-hint">{sync?.available && !sync.editable
        ? "Settings are read-only because settings.yaml requires migration. Update the file to schema version 2, then retry. "
        : "Settings changed or could not be verified. Discard this draft and reload the configuration before editing. "}<button type="button" className="settings-btn" onClick={() => {
        setNewGroup(""); recovery.dismiss();
      }}>{recovery.recovered ? "Discard recovered group name" : "Discard new group name draft"}</button></p>}
      {entryError && <p role="alert" className="settings-hint">{entryError}</p>}

      <fieldset className="settings-section settings-fieldset" disabled={disabled}>
      {groups.length === 0 ? (
        <p className="settings-empty">No groups declared yet.</p>
      ) : (
        <div className="groups-list">
          {groups.map((g, i) => (
            <GroupRow
              key={g.name}
              group={g}
              groupNames={groups.map((group) => group.name)}
              index={i}
              isFirst={i === 0}
              isLast={i === groups.length - 1}
              onReorder={onReorder}
              onRename={onRename}
              onToggleCollapsed={onToggleCollapsed}
              onDelete={onDelete}
              baselineRevision={baselineRevision}
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
          onChange={(e) => { setNewGroup(e.target.value); setEntryError(null); }}
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
          disabled={disabled || saveStatus === "saving"}
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
      </fieldset>
    </section>
  );
}
