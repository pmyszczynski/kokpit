"use client";

import { useEffect, useRef, useState } from "react";
import { Service } from "@/config/schema";
import { getAllWidgets } from "@/widgets";
import type { WidgetConfigField } from "@/widgets";

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
              aria-selected={false}
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

function WidgetConfigFields({
  fields,
  config,
  onChange,
}: {
  fields: WidgetConfigField[];
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <>
      {fields.map((field) => {
        const value = config[field.key];

        if (field.type === "multiselect" && field.options) {
          const selected = Array.isArray(value) ? (value as string[]) : [];
          return (
            <div key={field.key} className="settings-form-row settings-form-row--multiselect">
              <label>{field.label}</label>
              <div className="widget-multiselect">
                {field.options.map((opt) => (
                  <label key={opt.value} className="widget-multiselect__option">
                    <input
                      type="checkbox"
                      checked={selected.includes(opt.value)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...selected, opt.value]
                          : selected.filter((v) => v !== opt.value);
                        onChange(field.key, next);
                      }}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              {field.description && (
                <p className="settings-form-hint">{field.description}</p>
              )}
            </div>
          );
        }

        return (
          <div key={field.key} className="settings-form-row">
            <label htmlFor={`sf-widget-${field.key}`}>{field.label}{field.required && " *"}</label>
            <input
              id={`sf-widget-${field.key}`}
              type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
              value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
              onChange={(e) => {
                const raw = e.target.value;
                onChange(field.key, field.type === "number" ? (raw === "" ? undefined : Number(raw)) : raw);
              }}
              placeholder={field.placeholder}
              required={field.required}
            />
            {field.description && (
              <p className="settings-form-hint">{field.description}</p>
            )}
          </div>
        );
      })}
    </>
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

  // Widget state
  const widgets = getAllWidgets();
  const [widgetType, setWidgetType] = useState(service?.widget?.type ?? "");
  const [widgetConfig, setWidgetConfig] = useState<Record<string, unknown>>(
    (service?.widget?.config as Record<string, unknown>) ?? {}
  );
  const [refreshInterval, setRefreshInterval] = useState<string>(
    service?.widget?.refresh_interval_ms != null
      ? String(service.widget.refresh_interval_ms)
      : ""
  );

  const selectedWidget = widgets.find((w) => w.id === widgetType) ?? null;

  function handleWidgetConfigChange(key: string, value: unknown) {
    setWidgetConfig((prev) => ({ ...prev, [key]: value }));
  }

  function handleWidgetTypeChange(type: string) {
    setWidgetType(type);
    setWidgetConfig({});
    setRefreshInterval("");
  }

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const widget =
      widgetType
        ? {
            type: widgetType,
            config: Object.keys(widgetConfig).length > 0 ? widgetConfig : undefined,
            refresh_interval_ms: refreshInterval !== "" ? Number(refreshInterval) : undefined,
          }
        : undefined;

    onSave({
      name,
      url: url.trim() || undefined,
      icon: icon.trim() || undefined,
      description: description.trim() || undefined,
      group: group.trim() || undefined,
      widget,
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

        <div className="service-form__section-divider">
          <span>Widget</span>
        </div>

        <div className="settings-form-row">
          <label htmlFor="sf-widget-type">Widget type</label>
          <select
            id="sf-widget-type"
            value={widgetType}
            onChange={(e) => handleWidgetTypeChange(e.target.value)}
          >
            <option value="">None</option>
            {widgets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        {selectedWidget && (
          <>
            {selectedWidget.configFields && selectedWidget.configFields.length > 0 && (
              <WidgetConfigFields
                fields={selectedWidget.configFields}
                config={widgetConfig}
                onChange={handleWidgetConfigChange}
              />
            )}
            <div className="settings-form-row">
              <label htmlFor="sf-widget-refresh">Refresh interval (ms)</label>
              <input
                id="sf-widget-refresh"
                type="number"
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(e.target.value)}
                placeholder={`Default: ${selectedWidget.refreshInterval ?? 30000}`}
                min={5000}
                step={1000}
              />
            </div>
          </>
        )}

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
