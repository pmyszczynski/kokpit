"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Service,
  ServiceWidget,
  Size,
  serviceNameUniquenessKey,
} from "@/config/schema";
import { resolveServiceSize, sizeSatisfies } from "@/config";
import { resolveIconRef } from "@/config/iconRef";
import "@/integrations";
import {
  getWidget,
  getWidgetsWithServiceEditorPreset,
} from "@/widgets";
import type { WidgetConfigField } from "@/widgets";
import { SIZE_ORDER, sizeLabel } from "./settingsSizeOptions";

interface ServiceFormProps {
  service: Service | null;
  existingGroups: string[];
  /** Service names already in use (excluding the row being edited). */
  takenNames?: string[];
  /** Prefill the group field for a new service (edit-mode "add here"). */
  initialGroup?: string;
  /**
   * Prefill the tile type (and its default name/icon) for a new service added
   * from the edit-mode widget-preset picker. Ignored when editing an existing
   * service.
   */
  initialPreset?: string;
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

// Client-side mirror of the /api/icons/search result shape. Declared locally
// rather than imported from the server-only iconLibraries module so no
// server-only code is pulled into this client bundle.
interface IconSearchResult {
  ref: string;
  name: string;
  url: string;
  source: string;
}

type IconSearchStatus =
  | { state: "idle" }
  | { state: "searching" }
  | { state: "error" };

type IconUploadStatus =
  | { state: "idle" }
  | { state: "uploading" }
  | { state: "error"; message: string };

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Rejects non-http(s) URL schemes (e.g. "javascript:") before a value
// reaches an <img src>. Browsers already refuse to execute those as image
// sources, so this doesn't close a real exploit — it's a belt-and-suspenders
// check with no behavior cost for legitimate icon URLs.
function isSafeImagePreviewUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  if (trimmed.startsWith("/")) return true;
  return isValidHttpUrl(trimmed);
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
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);

  const suggestions = value.trim()
    ? groups.filter((g) => g.toLowerCase().includes(value.toLowerCase().trim()))
    : groups;

  const isNew = value.trim() !== "" && !groups.some((g) => g.toLowerCase() === value.toLowerCase().trim());
  const showDropdown = open && (suggestions.length > 0 || isNew);

  function select(g: string) {
    onChange(g);
    setOpen(false);
  }

  function handleBlur(e: React.FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (
      containerRef.current?.contains(next) ||
      dropdownRef.current?.contains(next)
    ) {
      return;
    }
    setOpen(false);
  }

  useLayoutEffect(() => {
    if (!showDropdown || !containerRef.current) {
      setCoords(null);
      return;
    }

    function updatePosition() {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCoords({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    // Capture scrolls from the dialog form body (and other ancestors).
    document.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [showDropdown, suggestions.length, isNew, value]);

  const portalHost = containerRef.current?.closest("dialog") ?? null;

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
      {showDropdown &&
        coords &&
        portalHost &&
        createPortal(
          <ul
            ref={dropdownRef}
            className="group-combobox__dropdown"
            role="listbox"
            style={{
              top: coords.top,
              left: coords.left,
              width: coords.width,
            }}
          >
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
          </ul>,
          portalHost
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
  initialGroup,
  initialPreset,
  onSave,
  onClose,
}: ServiceFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initial = initFromService(service);
  // For a NEW service opened from the edit-mode preset picker, seed the tile
  // type + its default name/icon exactly as picking it in the dropdown would.
  const presetDef =
    !service && initialPreset ? getWidget(initialPreset) : undefined;
  const presetEditor = presetDef?.serviceEditorPreset;
  const [name, setName] = useState(initial.name || presetEditor?.defaultName || "");
  const [url, setUrl] = useState(initial.url);
  const [icon, setIcon] = useState(
    initial.icon || presetEditor?.defaultIconUrl || ""
  );
  const [description, setDescription] = useState(initial.description);
  const [group, setGroup] = useState(initial.group || initialGroup || "");
  // Migrate a legacy `position`-only service to an explicit `size`: seed the
  // select with the size derived from `position` (clamped to the widget floor)
  // so saving writes an equivalent `size` and the effective size survives the
  // drop of the deprecated `position` field.
  const [size, setSize] = useState<Size | "">(() => {
    if (service?.size) return service.size;
    if (service?.position) {
      const min = service.widget
        ? getWidget(service.widget.type)?.minSize
        : undefined;
      return resolveServiceSize(service, undefined, min);
    }
    return "";
  });
  const [nameError, setNameError] = useState<string | null>(null);

  const [tileType, setTileType] = useState(
    initial.tileType || (presetEditor ? initialPreset ?? "" : "")
  );
  const [orphanWidget, setOrphanWidget] = useState<ServiceWidget | null>(initial.orphanWidget);
  const [widgetConfig, setWidgetConfig] = useState<Record<string, unknown>>(initial.widgetConfig);
  const [refreshInterval, setRefreshInterval] = useState<string>(initial.refreshInterval);
  const [testStatus, setTestStatus] = useState<TestStatus>({ state: "idle" });
  const [iconDetectStatus, setIconDetectStatus] = useState<IconDetectStatus>({ state: "idle" });
  const [iconPreviewError, setIconPreviewError] = useState(false);

  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [iconQuery, setIconQuery] = useState("");
  const [iconResults, setIconResults] = useState<IconSearchResult[]>([]);
  const [iconSearchStatus, setIconSearchStatus] = useState<IconSearchStatus>({ state: "idle" });
  const [iconUploadStatus, setIconUploadStatus] = useState<IconUploadStatus>({ state: "idle" });
  const iconFileInputRef = useRef<HTMLInputElement>(null);
  const iconSearchRequestId = useRef(0);

  const presetWidgets = getWidgetsWithServiceEditorPreset();

  const selectedWidgetDef =
    tileType !== ""
      ? getWidget(tileType) ?? null
      : orphanWidget
        ? getWidget(orphanWidget.type) ?? null
        : null;

  const showWidgetSection = tileType !== "" || orphanWidget !== null;

  const widgetMinSize: Size | undefined = selectedWidgetDef?.minSize;

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
    // Clear an explicit size the new widget can't satisfy; fall back to Auto.
    if (def?.minSize && size !== "" && !sizeSatisfies(size, def.minSize)) {
      setSize("");
    }
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
      const res = await fetch("/api/icon/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmedUrl, name: name.trim() }),
      });
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

  // Debounced icon-library search while the picker is open. Guarded by a
  // request id so a slow response can't overwrite results from a later query.
  useEffect(() => {
    if (!iconPickerOpen) return;
    const q = iconQuery.trim();
    if (q === "") {
      setIconResults([]);
      setIconSearchStatus({ state: "idle" });
      return;
    }
    const requestId = ++iconSearchRequestId.current;
    setIconSearchStatus({ state: "searching" });
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/icons/search?q=${encodeURIComponent(q)}`);
        if (iconSearchRequestId.current !== requestId) return;
        if (!res.ok) {
          setIconSearchStatus({ state: "error" });
          return;
        }
        const json = (await res.json()) as { results?: IconSearchResult[] };
        if (iconSearchRequestId.current !== requestId) return;
        setIconResults(json.results ?? []);
        setIconSearchStatus({ state: "idle" });
      } catch {
        if (iconSearchRequestId.current !== requestId) return;
        setIconSearchStatus({ state: "error" });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [iconQuery, iconPickerOpen]);

  function selectIconResult(result: IconSearchResult) {
    updateIcon(result.ref);
    iconDetectRequestId.current++;
    setIconPickerOpen(false);
  }

  async function handleIconUpload(file: File) {
    setIconUploadStatus({ state: "uploading" });
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/icons/upload", { method: "POST", body });
      const json = (await res.json()) as { path?: string; error?: string };
      if (!res.ok || !json.path) {
        setIconUploadStatus({
          state: "error",
          message: json.error ?? "Upload failed",
        });
        return;
      }
      updateIcon(json.path);
      iconDetectRequestId.current++;
      setIconUploadStatus({ state: "idle" });
    } catch (err) {
      setIconUploadStatus({
        state: "error",
        message: err instanceof Error ? err.message : "Upload failed",
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
      size: size || undefined,
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
        <div className="service-form__body">
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
                iconDetectRequestId.current++;
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
          <label htmlFor="sf-icon">Icon</label>
          <div className="service-form__icon-row">
            {isSafeImagePreviewUrl(resolveIconRef(icon).url) && !iconPreviewError && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolveIconRef(icon).url}
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
              placeholder="URL, or a shorthand like di-jellyfin"
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
          <div className="service-form__icon-actions">
            <button
              type="button"
              className="settings-btn"
              onClick={() => setIconPickerOpen((open) => !open)}
              aria-expanded={iconPickerOpen}
            >
              {iconPickerOpen ? "Hide icon browser" : "Browse icons"}
            </button>
            <button
              type="button"
              className="settings-btn"
              onClick={() => iconFileInputRef.current?.click()}
              disabled={iconUploadStatus.state === "uploading"}
            >
              {iconUploadStatus.state === "uploading" ? "Uploading…" : "Upload icon"}
            </button>
            <input
              ref={iconFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="service-form__icon-file-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleIconUpload(file);
                e.target.value = "";
              }}
            />
          </div>
          {iconUploadStatus.state === "error" && (
            <p className="settings-form-hint settings-form-hint--error" role="alert">
              {iconUploadStatus.message}
            </p>
          )}
          {iconPickerOpen && (
            <div className="service-form__icon-picker">
              <input
                type="text"
                className="settings-input"
                value={iconQuery}
                onChange={(e) => setIconQuery(e.target.value)}
                placeholder="Search icons (e.g. Sonarr)"
                aria-label="Search icons"
              />
              {iconSearchStatus.state === "searching" && (
                <p className="settings-form-hint">Searching…</p>
              )}
              {iconSearchStatus.state === "error" && (
                <p className="settings-form-hint settings-form-hint--error" role="alert">
                  Icon search failed — try again.
                </p>
              )}
              {iconSearchStatus.state === "idle" &&
                iconQuery.trim() !== "" &&
                iconResults.length === 0 && (
                  <p className="settings-form-hint">No icons found.</p>
                )}
              {iconResults.length > 0 && (
                <ul className="service-form__icon-grid" role="listbox" aria-label="Icon results">
                  {iconResults.map((result) => (
                    <li key={`${result.source}:${result.ref}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={icon === result.ref}
                        className="service-form__icon-option"
                        onClick={() => selectIconResult(result)}
                        title={`${result.name} (${result.source})`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={result.url} alt="" loading="lazy" />
                        <span className="service-form__icon-option-name">
                          {result.name}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
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
        <div className="settings-form-row">
          <label htmlFor="sf-size">Size</label>
          <select
            id="sf-size"
            className="settings-input"
            value={size}
            onChange={(e) => setSize(e.target.value as Size | "")}
          >
            <option value="">Auto</option>
            {SIZE_ORDER.map((s) => {
              const disabled = widgetMinSize
                ? !sizeSatisfies(s, widgetMinSize)
                : false;
              return (
                <option key={s} value={s} disabled={disabled}>
                  {sizeLabel(s)}
                  {disabled ? " — too small for this widget" : ""}
                </option>
              );
            })}
          </select>
          {widgetMinSize && (
            <span className="settings-form-hint">
              This widget needs at least {sizeLabel(widgetMinSize)}.
            </span>
          )}
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
