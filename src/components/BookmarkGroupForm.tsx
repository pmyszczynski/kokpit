"use client";

import { useConfigurationSync } from "./ConfigurationSyncProvider";

import { useEffect, useRef, useState } from "react";
import type { BookmarkGroup, BookmarkLink, Size } from "@/config/schema";
import { serviceNameUniquenessKey } from "@/config";
import { SIZE_ORDER, sizeLabel } from "./settingsSizeOptions";
import { canonicalJSONString } from "@/config/canonicalJson";
import { useDraftRecovery, useUnsavedChanges, useUnsavedSource } from "./unsaved/UnsavedChangesProvider";

interface BookmarkGroupFormProps {
  bookmark: BookmarkGroup | null;
  knownGroups: string[];
  /** Bookmark-group names already in use (excluding the one being edited). */
  takenNames?: string[];
  /** Prefill the placement group for a new bookmark (edit-mode "add here"). */
  initialGroup?: string;
  onSave: (bookmark: BookmarkGroup) => void | boolean | Promise<void | boolean>;
  onClose: () => void;
  draftScope?: "dashboard" | "settings";
  baselineRevision?: string | null;
  recoveryId?: string;
}

type LinkFields = {
  name: string;
  url: string;
  icon: string;
  abbr: string;
  description: string;
};
type LinkDraft = LinkFields & {
  originalIndex: number | null;
  changedFields: Record<keyof LinkFields, boolean>;
};

function toLinkDraft(link: BookmarkLink, originalIndex: number): LinkDraft {
  return {
    name: link.name,
    url: link.url,
    icon: link.icon ?? "",
    abbr: link.abbr ?? "",
    description: link.description ?? "",
    originalIndex,
    changedFields: { name: false, url: false, icon: false, abbr: false, description: false },
  };
}

const EMPTY_LINK: LinkDraft = {
  name: "",
  url: "",
  icon: "",
  abbr: "",
  description: "",
  originalIndex: null,
  changedFields: { name: false, url: false, icon: false, abbr: false, description: false },
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
  initialGroup,
  onSave,
  onClose,
  draftScope = "dashboard",
  baselineRevision = null,
  recoveryId,
}: BookmarkGroupFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const unsaved = useUnsavedChanges();
  const sync = useConfigurationSync();
  const initialFields = {
    name: bookmark?.name ?? "", accent: bookmark?.accent ?? "",
    placementGroup: bookmark?.placement?.group ?? initialGroup ?? "",
  };
  const [changedFields, setChangedFields] = useState({ name: false, accent: false, placementGroup: false });

  const [name, setName] = useState(bookmark?.name ?? "");
  const [accent, setAccent] = useState(bookmark?.accent ?? "");
  const [style, setStyle] = useState<NonNullable<BookmarkGroup["style"]>>(
    bookmark?.style ?? "list"
  );
  const [placementGroup, setPlacementGroup] = useState(
    bookmark?.placement?.group ?? initialGroup ?? ""
  );
  const [placementSize, setPlacementSize] = useState<Size | "">(
    bookmark?.placement?.size ?? ""
  );
  const [links, setLinks] = useState<LinkDraft[]>(
    bookmark?.links?.length ? bookmark.links.map(toLinkDraft) : [{ ...EMPTY_LINK }]
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryConflict, setRecoveryConflict] = useState(false);
  const sourceRevision = useRef(baselineRevision);
  const syncBlocked = Boolean(sync && (!sync.available || !sync.editable || sync.stale(sourceRevision.current)));
  const sourceId = recoveryId ?? `${draftScope}:bookmark-form:${bookmark?.name ?? `new:${initialGroup ?? ""}`}`;
  const version = canonicalJSONString({
    name: name.trim(), accent: accent.trim(), style, placementGroup: placementGroup.trim(), placementSize,
    links: links.filter((link) => link.name.trim() || link.url.trim()).map((link) => ({
      name: link.name.trim(), url: link.url.trim(), icon: link.icon.trim(),
      abbr: link.abbr.trim(), description: link.description.trim(),
    })),
  });
  const [baseline, setBaseline] = useState(version);
  const dirty = version !== baseline;
  const recovery = useDraftRecovery(sourceId, baselineRevision,
    { name: changedFields.name ? name : undefined, accent: changedFields.accent ? accent : undefined, style,
      placementGroup: changedFields.placementGroup ? placementGroup : undefined, placementSize, changedFields,
      links: links.map((link) => ({ originalIndex: link.originalIndex, changedFields: link.changedFields,
        name: link.changedFields.name ? link.name : undefined, url: link.changedFields.url ? link.url : undefined,
        icon: link.changedFields.icon ? link.icon : undefined, abbr: link.changedFields.abbr ? link.abbr : undefined,
        description: link.changedFields.description ? link.description : undefined })) }, dirty,
    (saved, changedRevision) => {
      setName(saved.changedFields.name ? saved.name ?? "" : initialFields.name);
      setAccent(saved.changedFields.accent ? saved.accent ?? "" : initialFields.accent);
      setPlacementGroup(saved.changedFields.placementGroup ? saved.placementGroup ?? "" : initialFields.placementGroup);
      setChangedFields(saved.changedFields); setStyle(saved.style);
      setPlacementSize(saved.placementSize);
      setLinks(saved.links.map((link) => {
        // Row provenance survives reorder/removal without caching the original
        // strings or restoring an intentional edit from a sanitized comparison.
        const original = link.originalIndex === null ? undefined : bookmark?.links[link.originalIndex];
        return { ...link,
          name: link.changedFields.name ? link.name ?? "" : original?.name ?? "",
          url: link.changedFields.url ? link.url ?? "" : original?.url ?? "",
          icon: link.changedFields.icon ? link.icon ?? "" : original?.icon ?? "",
          abbr: link.changedFields.abbr ? link.abbr ?? "" : original?.abbr ?? "",
          description: link.changedFields.description ? link.description ?? "" : original?.description ?? "",
        };
      }));
      setRecoveryConflict(changedRevision);
    });
  const closeWithoutWarning = () => { recovery.dismiss(); dialogRef.current?.close(); };
  function markFieldChanged(field: keyof typeof initialFields, value: string) {
    setChangedFields((previous) => ({ ...previous, [field]: value.trim() !== initialFields[field].trim() }));
  }
  useUnsavedSource(sourceId, {
    label: "Bookmark group form", dirty, saving: submitting, scope: draftScope, version,
    priority: 0,
    discard: () => { setBaseline(version); closeWithoutWarning(); },
    save: syncBlocked || recoveryConflict || recovery.validating || recovery.conflict ? undefined : submit,
  });

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function updateLink(index: number, patch: Partial<LinkFields>) {
    setLinks((prev) =>
      prev.map((link, i) => {
        if (i !== index) return link;
        const original = link.originalIndex === null ? undefined : bookmark?.links[link.originalIndex];
        const changed = { ...link.changedFields };
        for (const field of Object.keys(patch) as (keyof LinkFields)[]) {
          if (patch[field] !== undefined) changed[field] = patch[field].trim() !== (original?.[field] ?? "").trim();
        }
        return { ...link, ...patch, changedFields: changed };
      })
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
    if (unsaved) void unsaved.confirm({ ids: [sourceId] }).then((allowed) => { if (allowed) closeWithoutWarning(); });
    else closeWithoutWarning();
  }

  async function submit(): Promise<boolean> {
    if (submitting || syncBlocked || unsaved?.saving || recoveryConflict || recovery.validating || recovery.conflict) return false;
    const trimmedName = name.trim();
    if (trimmedName === "") {
      setError("Name is required.");
      return false;
    }
    const nameKey = serviceNameUniquenessKey(trimmedName);
    if (takenNames.some((n) => serviceNameUniquenessKey(n) === nameKey)) {
      setError("A bookmark group with this name already exists.");
      return false;
    }

    const cleanedLinks: BookmarkLink[] = [];
    for (const l of links) {
      const linkName = l.name.trim();
      const url = l.url.trim();
      if (linkName === "" && url === "") continue; // ignore fully-empty rows
      if (linkName === "" || url === "") {
        setError("Each link needs both a name and a URL.");
        return false;
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
      return false;
    }

    const placement =
      placementGroup.trim() !== "" || placementSize !== ""
        ? {
            group: placementGroup.trim() || undefined,
            size: (placementSize || undefined) as Size | undefined,
          }
        : undefined;

    setSubmitting(true);
    try {
    const accepted = await onSave({
      name: trimmedName,
      accent: accent.trim() || undefined,
      style: style === "list" ? undefined : style,
      placement,
      links: cleanedLinks,
    });
    if (accepted === false) return false;
    setBaseline(version); recovery.dismiss();
    return true;
    } catch { setError("Could not save this bookmark group. Please try again."); return false; }
    finally { setSubmitting(false); }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submit();
  }

  const accentIsHex = /^#[0-9a-fA-F]{6}$/.test(accent.trim());

  return (
    <dialog ref={dialogRef} className="service-form-dialog" onClose={onClose}
      onCancel={(event) => { event.preventDefault(); handleClose(); }}>
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
        {recovery.recovered && <p className="settings-hint" role="status">Recovered unsaved bookmark fields. URL query/fragment values may need re-entry; review before saving.</p>}
        {(syncBlocked || recoveryConflict || recovery.conflict) && <p className="settings-hint" role="alert">{sync?.available && !sync.editable
          ? "Settings are read-only because settings.yaml requires migration. Update the file to schema version 2, then reopen this form once settings can be edited."
          : "Settings changed or could not be verified. Close and reopen this form after reloading the configuration."}</p>}
        {!recovery.available && <p className="settings-hint" role="alert">This draft is too large for navigation recovery. Save before using browser Back or Forward.</p>}
        <div className="service-form__body"><fieldset className="service-form__fields settings-fieldset" disabled={submitting || unsaved?.saving || syncBlocked}>
          <div className="settings-form-row">
            <label htmlFor="bf-name">Name *</label>
            <input
              id="bf-name"
              type="text"
              className="settings-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                markFieldChanged("name", e.target.value);
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
                onChange={(e) => { setAccent(e.target.value); markFieldChanged("accent", e.target.value); }}
              />
              <input
                id="bf-accent"
                type="text"
                className="settings-input"
                value={accent}
                onChange={(e) => { setAccent(e.target.value); markFieldChanged("accent", e.target.value); }}
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
              onChange={(e) => { setPlacementGroup(e.target.value); markFieldChanged("placementGroup", e.target.value); }}
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
        </fieldset></div>

        <div className="service-form__actions">
          <button type="button" className="settings-btn" onClick={handleClose}>
            Cancel
          </button>
          <button type="submit" className="settings-save-btn" disabled={syncBlocked || submitting || unsaved?.saving || recovery.validating || recovery.conflict || recoveryConflict}>
            Save
          </button>
        </div>
      </form>
    </dialog>
  );
}
