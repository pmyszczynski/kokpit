"use client";

import { useEffect, useRef, useState } from "react";
import { Service } from "@/config/schema";

interface ServiceFormProps {
  service: Service | null;
  existingGroups: string[];
  onSave: (service: Service) => void;
  onClose: () => void;
}

function GroupCombobox({
  value,
  onChange,
  groups,
}: {
  value: string;
  onChange: (v: string) => void;
  groups: string[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const suggestions = value.trim()
    ? groups.filter((g) => g.toLowerCase().includes(value.toLowerCase().trim()))
    : groups;

  const isNew = value.trim() !== "" && !groups.some((g) => g.toLowerCase() === value.toLowerCase().trim());

  function select(g: string) {
    onChange(g);
    setOpen(false);
  }

  function handleBlur(e: React.FocusEvent) {
    // Only close if focus moves outside the container
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="group-combobox" onBlur={handleBlur}>
      <input
        id="sf-group"
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Media"
        autoComplete="off"
      />
      {open && (suggestions.length > 0 || isNew) && (
        <ul className="group-combobox__dropdown" role="listbox">
          {suggestions.map((g) => (
            <li
              key={g}
              role="option"
              aria-selected={g === value}
              className={`group-combobox__option${g === value ? " group-combobox__option--selected" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); select(g); }}
            >
              {g}
            </li>
          ))}
          {isNew && (
            <li
              role="option"
              className="group-combobox__option group-combobox__option--new"
              onMouseDown={(e) => { e.preventDefault(); select(value.trim()); }}
            >
              Create &ldquo;{value.trim()}&rdquo;
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function ServiceForm({
  service,
  existingGroups,
  onSave,
  onClose,
}: ServiceFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(service?.name ?? "");
  const [url, setUrl] = useState(service?.url ?? "");
  const [icon, setIcon] = useState(service?.icon ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [group, setGroup] = useState(service?.group ?? "");

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      name,
      url: url.trim() || undefined,
      icon: icon.trim() || undefined,
      description: description.trim() || undefined,
      group: group.trim() || undefined,
    });
  }

  function handleClose() {
    dialogRef.current?.close();
    // onClose is called via the dialog's native close event
  }

  return (
    <dialog ref={dialogRef} className="service-form-dialog" onClose={onClose}>
      <div className="service-form-dialog__header">
        <h2>{service ? "Edit Service" : "Add Service"}</h2>
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
        <div className="settings-form-row">
          <label htmlFor="sf-name">Name *</label>
          <input
            id="sf-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Jellyfin"
          />
        </div>
        <div className="settings-form-row">
          <label htmlFor="sf-url">URL</label>
          <input
            id="sf-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://jellyfin.example.com"
          />
        </div>
        <div className="settings-form-row">
          <label htmlFor="sf-icon">Icon URL</label>
          <input
            id="sf-icon"
            type="text"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="https://example.com/icon.png"
          />
        </div>
        <div className="settings-form-row">
          <label htmlFor="sf-description">Description</label>
          <input
            id="sf-description"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Media server"
          />
        </div>
        <div className="settings-form-row">
          <label htmlFor="sf-group">Group</label>
          <GroupCombobox
            value={group}
            onChange={setGroup}
            groups={existingGroups}
          />
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
