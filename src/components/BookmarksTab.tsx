"use client";

import { useState } from "react";
import type { BookmarkGroup } from "@/config/schema";
import { DEFAULT_BOOKMARK_STYLE } from "@/config";

type SaveStatus = "idle" | "saving" | "saved" | "error";

interface BookmarksTabProps {
  bookmarks: BookmarkGroup[];
  saveStatus: SaveStatus;
  onReorder: (from: number, to: number) => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
}

function BookmarkRow({
  bookmark,
  index,
  isFirst,
  isLast,
  onReorder,
  onEdit,
  onDelete,
}: {
  bookmark: BookmarkGroup;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onReorder: (from: number, to: number) => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="groups-row">
      <div className="groups-row__reorder">
        <button
          type="button"
          className="settings-icon-btn"
          aria-label={`Move ${bookmark.name} up`}
          disabled={isFirst}
          onClick={() => onReorder(index, index - 1)}
        >
          ▲
        </button>
        <button
          type="button"
          className="settings-icon-btn"
          aria-label={`Move ${bookmark.name} down`}
          disabled={isLast}
          onClick={() => onReorder(index, index + 1)}
        >
          ▼
        </button>
      </div>

      <span className="bookmarks-row__name">{bookmark.name}</span>
      <span className="bookmarks-row__meta">
        {bookmark.style ?? DEFAULT_BOOKMARK_STYLE} ·{" "}
        {bookmark.links.length} link{bookmark.links.length === 1 ? "" : "s"}
      </span>

      <span className="groups-row__actions">
        <button type="button" className="settings-btn" onClick={() => onEdit(index)}>
          Edit
        </button>
        {confirmDelete ? (
          <>
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
          </>
        ) : (
          <button
            type="button"
            className="settings-btn settings-btn--danger"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </button>
        )}
      </span>
    </div>
  );
}

export default function BookmarksTab({
  bookmarks,
  saveStatus,
  onReorder,
  onEdit,
  onDelete,
  onAdd,
}: BookmarksTabProps) {
  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Bookmarks</h2>

      {bookmarks.length === 0 ? (
        <p className="settings-empty">No bookmark groups yet.</p>
      ) : (
        <div className="groups-list">
          {bookmarks.map((b, i) => (
            <BookmarkRow
              key={b.name}
              bookmark={b}
              index={i}
              isFirst={i === 0}
              isLast={i === bookmarks.length - 1}
              onReorder={onReorder}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      <div className="settings-actions settings-actions--spaced">
        <button className="settings-save-btn" onClick={onAdd}>
          + Add bookmark group
        </button>
        {saveStatus === "saved" && (
          <span className="settings-save-feedback">Saved ✓</span>
        )}
        {saveStatus === "error" && (
          <span className="settings-save-feedback settings-save-feedback--error">
            Save failed
          </span>
        )}
      </div>
    </section>
  );
}
