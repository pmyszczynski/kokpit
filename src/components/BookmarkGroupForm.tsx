"use client";

import { useEffect, useRef, useState } from "react";
import type { BookmarkGroup, BookmarkLink, Size } from "@/config/schema";
import { serviceNameUniquenessKey } from "@/config";
import { SIZE_ORDER, sizeLabel } from "./settingsSizeOptions";

interface BookmarkGroupFormProps {
  bookmark: BookmarkGroup | null;
  knownGroups: string[];
  /** Bookmark-group names already in use (excluding the one being edited). */
  takenNames?: string[];
  onSave: (bookmark: BookmarkGroup) => void;
  onClose: () => void;
}

type LinkDraft = {
  name: string;
  url: string;
  icon: string;
  abbr: string;
  description: string;
};

function toLinkDraft(link: BookmarkLink): LinkDraft {
  return {
    name: link.name,
    url: link.url,
    icon: link.icon ?? "",
    abbr: link.abbr ?? "",
    description: link.description ?? "",
  };
}

const EMPTY_LINK: LinkDraft = {
  name: "",
  url: "",
  icon: "",
  abbr: "",
  description: "",
};

const STYLES: Array<{ value: NonNullable<BookmarkGroup["style"]>; label: string }> = [
  { value: "list", label: "List" },
  { value: "icon-grid", label: "Icon grid" },
  { value: "compact", label: "Compact" },
];

export default function BookmarkGroupForm({
  bookmark,
  knownGroups,
  takenNames = [],
  onSave,
  onClose,
}: BookmarkGroupFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [name, setName] = useState(bookmark?.name ?? "");
  const [accent, setAccent] = useState(bookmark?.accent ?? "");
  const [style, setStyle] = useState<NonNullable<BookmarkGroup["style"]>>(
    bookmark?.style ?? "list"
  );
  const [placementGroup, setPlacementGroup] = useState(
    bookmark?.placement?.group ?? ""
  );
  const [placementSize, setPlacementSize] = useState<Size | "">(
    bookmark?.placement?.size ?? ""
  );
  const [links, setLinks] = useState<LinkDraft[]>(
    bookmark?.links?.length ? bookmark.links.map(toLinkDraft) : [{ ...EMPTY_LINK }]
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function updateLink(index: number, patch: Partial<LinkDraft>) {
    setLinks((prev) =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l))
    );
    setError(null);
  }

  function addLink() {
    setLinks((prev) => [...prev, { ...EMPTY_LINK }]);
  }

  function removeLink(index: number) {
    setLinks((prev) => prev.filter((_, i) => i !== index));
  }

  function moveLink(from: number, to: number) {
    if (to < 0 || to >= links.length) return;
    setLinks((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function handleClose() {
    dialogRef.current?.close();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedName = name.trim();
    if (trimmedName === "") {
      setError("Name is required.");
      return;
    }
    const nameKey = serviceNameUniquenessKey(trimmedName);
    if (takenNames.some((n) => serviceNameUniquenessKey(n) === nameKey)) {
      setError("A bookmark group with this name already exists.");
      return;
    }

    const cleanedLinks: BookmarkLink[] = [];
    for (const l of links) {
      const linkName = l.name.trim();
      const url = l.url.trim();
      if (linkName === "" && url === "") continue; // ignore fully-empty rows
      if (linkName === "" || url === "") {
        setError("Each link needs both a name and a URL.");
        return;
      }
      cleanedLinks.push({
        name: linkName,
        url,
        icon: l.icon.trim() || undefined,
        abbr: l.abbr.trim() || undefined,
        description: l.description.trim() || undefined,
      });
    }

    if (cleanedLinks.length === 0) {
      setError("Add at least one link.");
      return;
    }

    const placement =
      placementGroup.trim() !== "" || placementSize !== ""
        ? {
            group: placementGroup.trim() || undefined,
            size: (placementSize || undefined) as Size | undefined,
          }
        : undefined;

    onSave({
      name: trimmedName,
      accent: accent.trim() || undefined,
      style: style === "list" ? undefined : style,
      placement,
      links: cleanedLinks,
    });
  }

  const accentIsHex = /^#[0-9a-fA-F]{6}$/.test(accent.trim());

  return (
    <dialog ref={dialogRef} className="service-form-dialog" onClose={onClose}>
      <div className="service-form-dialog__header">
        <h2>{bookmark ? "Edit Bookmark Group" : "Add Bookmark Group"}</h2>
        <button
          type="button"
          className="service-form-dialog__close"
          onClick={handleClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <form onSubmit={handleSubmit} className="service-form">
        <div className="service-form__body">
          <div className="settings-form-row">
            <label htmlFor="bf-name">Name *</label>
            <input
              id="bf-name"
              type="text"
              className="settings-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              required
              placeholder="Dev"
            />
          </div>

          <div className="settings-form-row">
            <label htmlFor="bf-accent">Accent color</label>
            <div className="bookmark-form__accent">
              <input
                type="color"
                aria-label="Accent color picker"
                className="bookmark-form__color"
                value={accentIsHex ? accent.trim() : "#7aa2f7"}
                onChange={(e) => setAccent(e.target.value)}
              />
              <input
                id="bf-accent"
                type="text"
                className="settings-input"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                placeholder="#7aa2f7 or rebeccapurple"
              />
            </div>
          </div>

          <div className="settings-form-row">
            <label htmlFor="bf-style">Style</label>
            <select
              id="bf-style"
              className="settings-input"
              value={style}
              onChange={(e) =>
                setStyle(e.target.value as NonNullable<BookmarkGroup["style"]>)
              }
            >
              {STYLES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-form-row">
            <label htmlFor="bf-placement-group">Placement group</label>
            <select
              id="bf-placement-group"
              className="settings-input"
              value={placementGroup}
              onChange={(e) => setPlacementGroup(e.target.value)}
            >
              <option value="">None (Bookmarks section)</option>
              {knownGroups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-form-row">
            <label htmlFor="bf-placement-size">Placement size</label>
            <select
              id="bf-placement-size"
              className="settings-input"
              value={placementSize}
              onChange={(e) => setPlacementSize(e.target.value as Size | "")}
            >
              <option value="">Auto</option>
              {SIZE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {sizeLabel(s)}
                </option>
              ))}
            </select>
          </div>

          <div className="service-form__section-divider">
            <span>Links</span>
          </div>

          {links.map((link, i) => (
            <div key={i} className="bookmark-link-row">
              <div className="bookmark-link-row__reorder">
                <button
                  type="button"
                  className="settings-icon-btn"
                  aria-label={`Move link ${link.name || i + 1} up`}
                  disabled={i === 0}
                  onClick={() => moveLink(i, i - 1)}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="settings-icon-btn"
                  aria-label={`Move link ${link.name || i + 1} down`}
                  disabled={i === links.length - 1}
                  onClick={() => moveLink(i, i + 1)}
                >
                  ▼
                </button>
              </div>
              <div className="bookmark-link-row__fields">
                <input
                  type="text"
                  className="settings-input"
                  aria-label={`Link ${i + 1} name`}
                  placeholder="Name *"
                  value={link.name}
                  onChange={(e) => updateLink(i, { name: e.target.value })}
                />
                <input
                  type="url"
                  className="settings-input"
                  aria-label={`Link ${i + 1} URL`}
                  placeholder="https://example.com *"
                  value={link.url}
                  onChange={(e) => updateLink(i, { url: e.target.value })}
                />
                <input
                  type="text"
                  className="settings-input"
                  aria-label={`Link ${i + 1} icon`}
                  placeholder="Icon (optional)"
                  value={link.icon}
                  onChange={(e) => updateLink(i, { icon: e.target.value })}
                />
                <input
                  type="text"
                  className="settings-input"
                  aria-label={`Link ${i + 1} abbreviation`}
                  placeholder="Abbr"
                  maxLength={2}
                  value={link.abbr}
                  onChange={(e) => updateLink(i, { abbr: e.target.value })}
                />
                <input
                  type="text"
                  className="settings-input"
                  aria-label={`Link ${i + 1} description`}
                  placeholder="Description (list style only)"
                  value={link.description}
                  onChange={(e) => updateLink(i, { description: e.target.value })}
                />
              </div>
              <button
                type="button"
                className="settings-btn settings-btn--danger"
                aria-label={`Remove link ${link.name || i + 1}`}
                onClick={() => removeLink(i)}
              >
                Remove
              </button>
            </div>
          ))}

          <p className="settings-form-hint">
            Descriptions only render in the &ldquo;list&rdquo; style.
          </p>

          <button type="button" className="settings-btn" onClick={addLink}>
            + Add link
          </button>

          {error && (
            <p className="settings-form-hint settings-form-hint--error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="service-form__actions">
          <button type="button" className="settings-btn" onClick={handleClose}>
            Cancel
          </button>
          <button type="submit" className="settings-save-btn">
            Save
          </button>
        </div>
      </form>
    </dialog>
  );
}
