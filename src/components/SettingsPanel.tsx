"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KokpitConfig, Service } from "@/config/schema";
import ServiceForm from "./ServiceForm";

type Tab = "appearance" | "layout" | "auth" | "services";
type SaveStatus = "idle" | "saving" | "saved" | "error";

const THEMES = ["dark", "light", "oled", "high-contrast"] as const;

export default function SettingsPanel({ config }: { config: KokpitConfig }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<Tab>("appearance");

  // Appearance
  const [theme, setTheme] = useState(config.appearance.theme);
  const [customCss, setCustomCss] = useState(config.appearance.custom_css ?? "");

  // Layout
  const [columns, setColumns] = useState(config.layout.columns);
  const [rowHeight, setRowHeight] = useState(config.layout.row_height);
  const [tabletColumns, setTabletColumns] = useState(config.layout.tablet?.columns?.toString() ?? "");
  const [tabletRowHeight, setTabletRowHeight] = useState(config.layout.tablet?.row_height?.toString() ?? "");
  const [mobileColumns, setMobileColumns] = useState(config.layout.mobile?.columns?.toString() ?? "");
  const [mobileRowHeight, setMobileRowHeight] = useState(config.layout.mobile?.row_height?.toString() ?? "");
  const [layoutViewport, setLayoutViewport] = useState<"desktop" | "tablet" | "mobile">("desktop");

  // Auth
  const [sessionTtl, setSessionTtl] = useState(config.auth.session_ttl_hours);

  // Services
  const [services, setServices] = useState<Service[]>(config.services);
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // Per-tab save status
  const [saveStatus, setSaveStatus] = useState<Record<Tab, SaveStatus>>({
    appearance: "idle",
    layout: "idle",
    auth: "idle",
    services: "idle",
  });

  async function save(section: Tab, data: unknown) {
    setSaveStatus((s) => ({ ...s, [section]: "saving" }));
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [section]: data }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaveStatus((s) => ({ ...s, [section]: "saved" }));
      startTransition(() => router.refresh());
      setTimeout(() => setSaveStatus((s) => ({ ...s, [section]: "idle" })), 2000);
    } catch {
      setSaveStatus((s) => ({ ...s, [section]: "error" }));
    }
  }

  function handleThemeSelect(t: typeof THEMES[number]) {
    setTheme(t);
    document.documentElement.dataset.theme = t;
  }

  function handleSaveAppearance() {
    save("appearance", { theme, custom_css: customCss || undefined });
  }

  function handleSaveLayout() {
    function parseViewport(cols: string, rh: string) {
      const c = parseInt(cols);
      const r = parseInt(rh);
      const obj: Record<string, number> = {};
      if (!isNaN(c) && c > 0) obj.columns = c;
      if (!isNaN(r) && r > 0) obj.row_height = r;
      return Object.keys(obj).length > 0 ? obj : undefined;
    }
    save("layout", {
      columns,
      row_height: rowHeight,
      tablet: parseViewport(tabletColumns, tabletRowHeight),
      mobile: parseViewport(mobileColumns, mobileRowHeight),
    });
  }

  function handleSaveAuth() {
    save("auth", { enabled: config.auth.enabled, session_ttl_hours: sessionTtl });
  }

  function handleServiceSave(service: Service) {
    const next = [...services];
    if (editingIndex !== null) {
      next[editingIndex] = service;
    } else {
      next.push(service);
    }
    setServices(next);
    setShowServiceForm(false);
    setEditingIndex(null);
    save("services", next);
  }

  function handleServiceDelete(index: number) {
    const next = services.filter((_, i) => i !== index);
    setServices(next);
    save("services", next);
  }

  function openAddForm() {
    setEditingIndex(null);
    setShowServiceForm(true);
  }

  function openEditForm(index: number) {
    setEditingIndex(index);
    setShowServiceForm(true);
  }

  function closeServiceForm() {
    setShowServiceForm(false);
    setEditingIndex(null);
  }

  function SaveButton({ section }: { section: Tab }) {
    const status = saveStatus[section];
    return (
      <button
        className="settings-save-btn"
        onClick={() => {
          if (section === "appearance") handleSaveAppearance();
          else if (section === "layout") handleSaveLayout();
          else if (section === "auth") handleSaveAuth();
        }}
        disabled={status === "saving"}
      >
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : status === "error" ? "Error — Retry" : "Save"}
      </button>
    );
  }

  return (
    <div className="settings-panel">
      <nav className="settings-tabs" aria-label="Settings sections">
        {(["appearance", "layout", "auth", "services"] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`settings-tab${activeTab === tab ? " settings-tab--active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      <div className="settings-content">
        {/* APPEARANCE */}
        {activeTab === "appearance" && (
          <section className="settings-section">
            <h2 className="settings-section__title">Appearance</h2>

            <div className="settings-form-row">
              <label>Theme</label>
              <div className="theme-picker">
                {THEMES.map((t) => (
                  <button
                    key={t}
                    className={`theme-option${theme === t ? " theme-option--active" : ""}`}
                    onClick={() => handleThemeSelect(t)}
                    data-theme-preview={t}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-form-row settings-form-row--column">
              <label htmlFor="custom-css">Custom CSS</label>
              <textarea
                id="custom-css"
                className="settings-textarea"
                value={customCss}
                onChange={(e) => setCustomCss(e.target.value)}
                placeholder=".service-tile { border-radius: 0; }"
                rows={8}
              />
              <span className="settings-hint">
                Injected last — no !important needed.
              </span>
            </div>

            <div className="settings-actions">
              <SaveButton section="appearance" />
            </div>
          </section>
        )}

        {/* LAYOUT */}
        {activeTab === "layout" && (
          <section className="settings-section">
            <h2 className="settings-section__title">Layout</h2>

            <div className="layout-viewport-tabs">
              {(["desktop", "tablet", "mobile"] as const).map((vp) => (
                <button
                  key={vp}
                  type="button"
                  className={`layout-viewport-tab${layoutViewport === vp ? " layout-viewport-tab--active" : ""}`}
                  onClick={() => setLayoutViewport(vp)}
                >
                  {vp.charAt(0).toUpperCase() + vp.slice(1)}
                </button>
              ))}
            </div>

            {layoutViewport === "desktop" && (
              <>
                <div className="settings-form-row">
                  <label htmlFor="columns">Columns</label>
                  <input
                    id="columns"
                    type="number"
                    min={1}
                    max={12}
                    value={columns}
                    onChange={(e) => setColumns(Math.max(1, Math.min(12, Number(e.target.value))))}
                    className="settings-input settings-input--narrow"
                  />
                </div>
                <div className="settings-form-row">
                  <label htmlFor="row-height">Row height (px)</label>
                  <input
                    id="row-height"
                    type="number"
                    min={60}
                    max={400}
                    value={rowHeight}
                    onChange={(e) => setRowHeight(Math.max(60, Number(e.target.value)))}
                    className="settings-input settings-input--narrow"
                  />
                </div>
              </>
            )}

            {layoutViewport === "tablet" && (
              <>
                <p className="settings-hint">Leave blank to use the Desktop value.</p>
                <div className="settings-form-row">
                  <label htmlFor="tablet-columns">Columns</label>
                  <input
                    id="tablet-columns"
                    type="number"
                    min={1}
                    max={12}
                    value={tabletColumns}
                    onChange={(e) => setTabletColumns(e.target.value)}
                    placeholder={String(columns)}
                    className="settings-input settings-input--narrow"
                  />
                </div>
                <div className="settings-form-row">
                  <label htmlFor="tablet-row-height">Row height (px)</label>
                  <input
                    id="tablet-row-height"
                    type="number"
                    min={60}
                    max={400}
                    value={tabletRowHeight}
                    onChange={(e) => setTabletRowHeight(e.target.value)}
                    placeholder={String(rowHeight)}
                    className="settings-input settings-input--narrow"
                  />
                </div>
              </>
            )}

            {layoutViewport === "mobile" && (
              <>
                <p className="settings-hint">Leave blank to use the Desktop value.</p>
                <div className="settings-form-row">
                  <label htmlFor="mobile-columns">Columns</label>
                  <input
                    id="mobile-columns"
                    type="number"
                    min={1}
                    max={12}
                    value={mobileColumns}
                    onChange={(e) => setMobileColumns(e.target.value)}
                    placeholder={String(columns)}
                    className="settings-input settings-input--narrow"
                  />
                </div>
                <div className="settings-form-row">
                  <label htmlFor="mobile-row-height">Row height (px)</label>
                  <input
                    id="mobile-row-height"
                    type="number"
                    min={60}
                    max={400}
                    value={mobileRowHeight}
                    onChange={(e) => setMobileRowHeight(e.target.value)}
                    placeholder={String(rowHeight)}
                    className="settings-input settings-input--narrow"
                  />
                </div>
              </>
            )}

            <div className="settings-actions">
              <SaveButton section="layout" />
            </div>
          </section>
        )}

        {/* AUTH */}
        {activeTab === "auth" && (
          <section className="settings-section">
            <h2 className="settings-section__title">Authentication</h2>

            <div className="settings-form-row">
              <label htmlFor="session-ttl">Session duration (hours)</label>
              <input
                id="session-ttl"
                type="number"
                min={1}
                max={8760}
                value={sessionTtl}
                onChange={(e) => setSessionTtl(Math.max(1, Number(e.target.value)))}
                className="settings-input settings-input--narrow"
              />
              <span className="settings-hint">
                New sessions will use this value. Existing sessions are unaffected.
              </span>
            </div>

            <div className="settings-actions">
              <SaveButton section="auth" />
            </div>
          </section>
        )}

        {/* SERVICES */}
        {activeTab === "services" && (
          <section className="settings-section">
            <h2 className="settings-section__title">Services</h2>

            {services.length === 0 ? (
              <p className="settings-empty">No services configured yet.</p>
            ) : (
              <table className="service-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>URL</th>
                    <th>Group</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((svc, i) => (
                    <tr key={i}>
                      <td>{svc.name}</td>
                      <td className="service-table__url">{svc.url ?? "—"}</td>
                      <td>{svc.group ?? "—"}</td>
                      <td className="service-table__actions">
                        <button
                          className="settings-btn"
                          onClick={() => openEditForm(i)}
                        >
                          Edit
                        </button>
                        <button
                          className="settings-btn settings-btn--danger"
                          onClick={() => handleServiceDelete(i)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="settings-actions settings-actions--spaced">
              <button className="settings-save-btn" onClick={openAddForm}>
                + Add Service
              </button>
              {saveStatus.services === "saved" && (
                <span className="settings-save-feedback">Saved ✓</span>
              )}
              {saveStatus.services === "error" && (
                <span className="settings-save-feedback settings-save-feedback--error">
                  Save failed
                </span>
              )}
            </div>
          </section>
        )}
      </div>

      {showServiceForm && (
        <ServiceForm
          service={editingIndex !== null ? services[editingIndex] : null}
          existingGroups={[...new Set(services.map((s) => s.group).filter(Boolean) as string[])]}
          onSave={handleServiceSave}
          onClose={closeServiceForm}
        />
      )}
    </div>
  );
}
