"use client";

import { useEffect, useRef, useState } from "react";
import {
  Service,
  ServiceWidget,
  serviceNameUniquenessKey,
} from "@/config/schema";
import "@/integrations";
import {
  getWidget,
  getWidgetsWithServiceEditorPreset,
} from "@/widgets";
import type { WidgetConfigField } from "@/widgets";

interface ServiceFormProps {
  service: Service | null;
  existingGroups: string[];
  /** Service names already in use (excluding the row being edited). */
  takenNames?: string[];
  onSave: (service: Service) => void;
  onClose: () => void;
}

function initFromService(service: Service | null): {
  name: string;
  url: string;
  icon: string;
  description: string;
  group: string;
  tileType: string;
  orphanWidget: ServiceWidget | null;
  widgetConfig: Record<string, unknown>;
  refreshInterval: string;
} {
  const base = {
    name: service?.name ?? "",
    url: service?.url ?? "",
    icon: service?.icon ?? "",
    description: service?.description ?? "",
    group: service?.group ?? "",
  };
  const w = service?.widget;
  if (!w) {
    return {
      ...base,
      tileType: "",
      orphanWidget: null,
      widgetConfig: {},
      refreshInterval: "",
    };
  }
  const def = getWidget(w.type);
  if (def?.serviceEditorPreset) {
    return {
      ...base,
      tileType: w.type,
      orphanWidget: null,
      widgetConfig: (w.config as Record<string, unknown>) ?? {},
      refreshInterval:
        w.refresh_interval_ms != null ? String(w.refresh_interval_ms) : "",
    };
  }
  return {
    ...base,
    tileType: "",
    orphanWidget: { ...w },
    widgetConfig: {},
    refreshInterval: "",
  };
}

/**
 * Drops entries that don't count as "configured": empty strings, empty
 * arrays, null/undefined. A widget config that cleans down to {} means the
 * user left the widget unconfigured and the tile renders as a plain link.
 */
function cleanWidgetConfig(
  config: Record<string, unknown>
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

type TestStatus =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "success" }
  | { state: "error"; message: string };

type IconDetectStatus =
  | { state: "idle" }
  | { state: "detecting" }
  | { state: "not-found" }
  | { state: "error"; message: string };

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
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
        className="settings-input"
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
              className="settings-input"
              value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
              onChange={(e) => {
                const raw = e.target.value;
                onChange(field.key, field.type === "number" ? (raw === "" ? undefined : Number(raw)) : raw);
              }}
              placeholder={field.placeholder}
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
  takenNames = [],
  onSave,
  onClose,
}: ServiceFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initial = initFromService(service);
  const [name, setName] = useState(initial.name);
  const [url, setUrl] = useState(initial.url);
  const [icon, setIcon] = useState(initial.icon);
  const [description, setDescription] = useState(initial.description);
  const [group, setGroup] = useState(initial.group);
  const [nameError, setNameError] = useState<string | null>(null);

  const [tileType, setTileType] = useState(initial.tileType);
  const [orphanWidget, setOrphanWidget] = useState<ServiceWidget | null>(initial.orphanWidget);
  const [widgetConfig, setWidgetConfig] = useState<Record<string, unknown>>(initial.widgetConfig);
  const [refreshInterval, setRefreshInterval] = useState<string>(initial.refreshInterval);
  const [testStatus, setTestStatus] = useState<TestStatus>({ state: "idle" });
  const [iconDetectStatus, setIconDetectStatus] = useState<IconDetectStatus>({ state: "idle" });
  const [iconPreviewError, setIconPreviewError] = useState(false);

  const presetWidgets = getWidgetsWithServiceEditorPreset();

  const selectedWidgetDef =
    tileType !== ""
      ? getWidget(tileType) ?? null
      : orphanWidget
        ? getWidget(orphanWidget.type) ?? null
        : null;

  const showWidgetSection = tileType !== "" || orphanWidget !== null;

  const activeWidgetType =
    tileType !== "" ? tileType : orphanWidget?.type ?? null;
  const activeCleanedConfig = cleanWidgetConfig(
    tileType !== ""
      ? widgetConfig
      : ((orphanWidget?.config as Record<string, unknown>) ?? {})
  );
  // Mirrors the dashboard's rule: the widget renders only when its config
  // passes the schema. Unknown types can't be validated client-side.
  const widgetConfigValid = selectedWidgetDef
    ? selectedWidgetDef.configSchema.safeParse(activeCleanedConfig).success
    : null;

  function handleWidgetConfigChange(key: string, value: unknown) {
    setWidgetConfig((prev) => ({ ...prev, [key]: value }));
    setTestStatus({ state: "idle" });
  }

  function handleOrphanWidgetConfigChange(key: string, value: unknown) {
    setOrphanWidget((prev) => {
      if (!prev) return prev;
      const cfg = { ...((prev.config as Record<string, unknown>) ?? {}), [key]: value };
      return { ...prev, config: cfg };
    });
    setTestStatus({ state: "idle" });
  }

  function handleTileTypeChange(newTile: string) {
    setTestStatus({ state: "idle" });
    if (newTile === "") {
      if (tileType !== "") {
        setOrphanWidget(null);
      }
      setTileType("");
      setWidgetConfig({});
      setRefreshInterval("");
      return;
    }
    setTileType(newTile);
    setOrphanWidget(null);
    setWidgetConfig({});
    setRefreshInterval("");
    const def = getWidget(newTile);
    if (def?.serviceEditorPreset) {
      setName(def.serviceEditorPreset.defaultName);
      setIcon(def.serviceEditorPreset.defaultIconUrl);
      setIconPreviewError(false);
      setIconDetectStatus({ state: "idle" });
      iconDetectRequestId.current++;
    }
  }

  async function handleTestConnection() {
    if (!activeWidgetType) return;
    setTestStatus({ state: "testing" });
    try {
      const res = await fetch("/api/widget/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: activeWidgetType,
          config: activeCleanedConfig,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (json.ok) {
        setTestStatus({ state: "success" });
      } else {
        setTestStatus({
          state: "error",
          message: json.error ?? "Connection test failed",
        });
      }
    } catch (err) {
      setTestStatus({
        state: "error",
        message: err instanceof Error ? err.message : "Connection test failed",
      });
    }
  }

  function updateIcon(value: string) {
    setIcon(value);
    setIconPreviewError(false);
  }

  // Bumped on every manual URL/icon edit and at the start of each detect
  // request. A response is only applied if this still matches the id it
  // was issued under — guards against a slow/superseded request landing
  // after the user has since edited the field or re-clicked the button.
  const iconDetectRequestId = useRef(0);

  async function handleDetectIcon() {
    const trimmedUrl = url.trim();
    if (!isValidHttpUrl(trimmedUrl)) return;
    const requestId = ++iconDetectRequestId.current;
    setIconDetectStatus({ state: "detecting" });
    try {
      const res = await fetch(`/api/icon/detect?url=${encodeURIComponent(trimmedUrl)}`);
      if (iconDetectRequestId.current !== requestId) return;
      if (!res.ok) {
        setIconDetectStatus({ state: "error", message: "Icon detection failed" });
        return;
      }
      const json = (await res.json()) as { icon: string | null };
      if (iconDetectRequestId.current !== requestId) return;
      if (json.icon) {
        updateIcon(json.icon);
        setIconDetectStatus({ state: "idle" });
      } else {
        setIconDetectStatus({ state: "not-found" });
      }
    } catch (err) {
      if (iconDetectRequestId.current !== requestId) return;
      setIconDetectStatus({
        state: "error",
        message: err instanceof Error ? err.message : "Icon detection failed",
      });
    }
  }

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedName = name.trim();
    if (trimmedName === "") {
      setNameError("Name is required.");
      return;
    }

    const nameKey = serviceNameUniquenessKey(trimmedName);
    if (takenNames.some((n) => serviceNameUniquenessKey(n) === nameKey)) {
      setNameError("A service with this name already exists.");
      return;
    }
    setNameError(null);

    let widget: ServiceWidget | undefined;
    if (tileType !== "") {
      const cfg = cleanWidgetConfig(widgetConfig);
      widget = {
        type: tileType,
        config: Object.keys(cfg).length > 0 ? cfg : undefined,
        refresh_interval_ms:
          refreshInterval !== "" ? Number(refreshInterval) : undefined,
      };
    } else if (orphanWidget) {
      const cfg = orphanWidget.config as Record<string, unknown> | undefined;
      widget = {
        type: orphanWidget.type,
        config:
          cfg && Object.keys(cfg).length > 0 ? cfg : undefined,
        fields: orphanWidget.fields?.length ? orphanWidget.fields : undefined,
        refresh_interval_ms: orphanWidget.refresh_interval_ms,
      };
    }

    onSave({
      name: trimmedName,
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

  const orphanConfig = (orphanWidget?.config as Record<string, unknown>) ?? {};

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
          <label htmlFor="sf-tile-type">Tile type</label>
          <select
            id="sf-tile-type"
            className="settings-input"
            value={tileType}
            onChange={(e) => handleTileTypeChange(e.target.value)}
          >
            <option value="">Generic</option>
            {presetWidgets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        {orphanWidget && (
          <p className="settings-form-hint">
            This tile has widget type &ldquo;{orphanWidget.type}&rdquo;, which is not in the list
            above. It will be kept unless you pick an integration. To remove it, choose an integration
            then switch back to Generic.
          </p>
        )}

        <div className="settings-form-row">
          <label htmlFor="sf-name">Name *</label>
          <div className="service-form__field-stack">
            <input
              id="sf-name"
              type="text"
              className="settings-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
              }}
              required
              placeholder="Jellyfin"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "sf-name-error" : undefined}
            />
            {nameError && (
              <p
                id="sf-name-error"
                className="settings-form-hint settings-form-hint--error"
                role="alert"
              >
                {nameError}
              </p>
            )}
          </div>
        </div>
        <div className="settings-form-row">
          <label htmlFor="sf-url">URL</label>
          <input
            id="sf-url"
            type="url"
            className="settings-input"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              iconDetectRequestId.current++;
            }}
            placeholder="https://jellyfin.example.com"
          />
        </div>
        <div className="settings-form-row">
          <label htmlFor="sf-icon">Icon URL</label>
          <div className="service-form__icon-row">
            {icon.trim() !== "" && !iconPreviewError && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={icon}
                alt=""
                className="service-form__icon-preview"
                onError={() => setIconPreviewError(true)}
              />
            )}
            <input
              id="sf-icon"
              type="text"
              className="settings-input"
              value={icon}
              onChange={(e) => {
                updateIcon(e.target.value);
                iconDetectRequestId.current++;
              }}
              placeholder="https://example.com/icon.png"
            />
            <button
              type="button"
              className="settings-btn service-form__icon-detect-btn"
              onClick={handleDetectIcon}
              disabled={
                iconDetectStatus.state === "detecting" || !isValidHttpUrl(url)
              }
            >
              {iconDetectStatus.state === "detecting" ? "Detecting…" : "Detect icon"}
            </button>
          </div>
          {iconDetectStatus.state === "not-found" && (
            <p className="settings-form-hint">
              No icon found — enter a URL manually.
            </p>
          )}
          {iconDetectStatus.state === "error" && (
            <p className="settings-form-hint settings-form-hint--error" role="alert">
              {iconDetectStatus.message}
            </p>
          )}
        </div>
        <div className="settings-form-row">
          <label htmlFor="sf-description">Description</label>
          <input
            id="sf-description"
            type="text"
            className="settings-input"
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

        {showWidgetSection && (
          <>
            <div className="service-form__section-divider">
              <span>Widget</span>
            </div>

            {tileType !== "" && (
              <p className="settings-form-hint">
                Optional — leave these fields empty to add a plain link tile.
                You can configure the widget later.
              </p>
            )}

            {selectedWidgetDef?.configFields &&
              selectedWidgetDef.configFields.length > 0 && (
                <WidgetConfigFields
                  fields={selectedWidgetDef.configFields}
                  config={tileType !== "" ? widgetConfig : orphanConfig}
                  onChange={
                    tileType !== ""
                      ? handleWidgetConfigChange
                      : handleOrphanWidgetConfigChange
                  }
                />
              )}

            {orphanWidget && !selectedWidgetDef?.configFields?.length && (
              <p className="settings-form-hint">
                No form fields for this widget type; raw config is preserved on save.
              </p>
            )}

            <div className="settings-form-row">
              <label htmlFor="sf-widget-refresh">Refresh interval (ms)</label>
              <input
                id="sf-widget-refresh"
                type="number"
                className="settings-input"
                value={
                  tileType !== ""
                    ? refreshInterval
                    : orphanWidget?.refresh_interval_ms != null
                      ? String(orphanWidget.refresh_interval_ms)
                      : ""
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (tileType !== "") {
                    setRefreshInterval(v);
                  } else if (orphanWidget) {
                    setOrphanWidget((prev) =>
                      prev
                        ? {
                            ...prev,
                            refresh_interval_ms:
                              v === "" ? undefined : Number(v),
                          }
                        : prev
                    );
                  }
                }}
                placeholder={`Default: ${selectedWidgetDef?.refreshInterval ?? 30000}`}
                min={5000}
                step={1000}
              />
            </div>

            {selectedWidgetDef && (
              <p
                role="status"
                className={`settings-form-hint service-form__widget-status service-form__widget-status--${
                  widgetConfigValid ? "active" : "inactive"
                }`}
              >
                {widgetConfigValid
                  ? "Widget configured — it will render on the dashboard tile."
                  : "Widget not configured — the tile will render as a plain link until the required fields are filled."}
              </p>
            )}

            <div className="service-form__test-row">
              <button
                type="button"
                className="settings-btn"
                onClick={handleTestConnection}
                disabled={
                  testStatus.state === "testing" || widgetConfigValid === false
                }
              >
                {testStatus.state === "testing" ? "Testing…" : "Test connection"}
              </button>
              {testStatus.state === "success" && (
                <span
                  className="service-form__test-result service-form__test-result--success"
                  role="status"
                >
                  Connection OK
                </span>
              )}
              {testStatus.state === "error" && (
                <span
                  className="service-form__test-result service-form__test-result--error"
                  role="alert"
                >
                  {testStatus.message}
                </span>
              )}
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
