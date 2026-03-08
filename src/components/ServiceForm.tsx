"use client";

import { useEffect, useRef, useState } from "react";
import { Service } from "@/config/schema";

interface ServiceFormProps {
  service: Service | null;
  onSave: (service: Service) => void;
  onClose: () => void;
}

export default function ServiceForm({
  service,
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
    onClose();
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
          <input
            id="sf-group"
            type="text"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="Media"
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
