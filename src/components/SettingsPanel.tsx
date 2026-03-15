"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KokpitConfig, Service } from "@/config/schema";
import ServiceForm from "./ServiceForm";

type Tab = "appearance" | "layout" | "auth" | "services";

type TotpState =
  | { status: "loading" }
  | { status: "enabled" }
  | { status: "setup"; secret: string; qrCode: string }
  | { status: "error" };
type SaveStatus = "idle" | "saving" | "saved" | "error";

const THEMES = ["dark", "light", "oled", "high-contrast"] as const;

function SaveButton({ status, onSave }: { status: SaveStatus; onSave: () => void }) {
  return (
    <button
      className="settings-save-btn"
      onClick={onSave}
      disabled={status === "saving"}
    >
      {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : status === "error" ? "Error — Retry" : "Save"}
    </button>
  );
}

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
  const [totp, setTotp] = useState<TotpState>({ status: "loading" });
  const [totpCode, setTotpCode] = useState("");
  const [totpMessage, setTotpMessage] = useState<string | null>(null);
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [totpDisableCode, setTotpDisableCode] = useState("");

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

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  async function fetchTotpStatus() {
    setTotp({ status: "loading" });
    setTotpMessage(null);
    try {
      const res = await fetch("/api/auth/totp/setup");
      if (!res.ok) { setTotp({ status: "error" }); return; }
      const json = await res.json();
      if (json.enabled) {
        setTotp({ status: "enabled" });
      } else {
        setTotp({ status: "setup", secret: json.secret, qrCode: json.qrCode });
      }
    } catch {
      setTotp({ status: "error" });
    }
  }

  const totpFetchedRef = useRef(false);
  useEffect(() => {
    if (activeTab === "auth" && !totpFetchedRef.current) {
      totpFetchedRef.current = true;
      fetchTotpStatus();
    }
  }, [activeTab]);

  async function handleTotpEnable() {
    if (totp.status !== "setup") return;
    setTotpMessage(null);
    const res = await fetch("/api/auth/totp/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: totp.secret, code: totpCode }),
    });
    if (res.ok) {
      setTotpCode("");
      setTotpMessage("2FA enabled successfully.");
      await fetchTotpStatus();
    } else {
      const json = await res.json();
      setTotpMessage(json.error ?? "Failed to enable 2FA");
    }
  }

  async function handleTotpDisable() {
    setTotpMessage(null);
    const res = await fetch("/api/auth/totp/setup", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: totpDisableCode }),
    });
    if (res.ok) {
      setTotpDisableCode("");
      setShowDisableConfirm(false);
      setTotpMessage("2FA disabled.");
      await fetchTotpStatus();
    } else {
      const json = await res.json();
      setTotpMessage(json.error ?? "Failed to disable 2FA");
    }
  }

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
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveStatus((s) => ({ ...s, [section]: "idle" })), 2000);
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
              <SaveButton status={saveStatus.appearance} onSave={handleSaveAppearance} />
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
              <SaveButton status={saveStatus.layout} onSave={handleSaveLayout} />
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
              <SaveButton status={saveStatus.auth} onSave={handleSaveAuth} />
            </div>

            <h3 className="settings-section__subtitle">Two-Factor Authentication</h3>

            {totp.status === "loading" && (
              <p className="settings-hint">Loading…</p>
            )}

            {totp.status === "error" && (
              <p className="settings-hint">Failed to load 2FA status.</p>
            )}

            {totp.status === "enabled" && (
              <div className="settings-form-row settings-form-row--column">
                <p style={{ margin: 0 }}>2FA is <strong>enabled</strong> on your account.</p>
                {!showDisableConfirm ? (
                  <button
                    className="settings-btn settings-btn--danger"
                    onClick={() => { setShowDisableConfirm(true); setTotpMessage(null); }}
                  >
                    Disable 2FA
                  </button>
                ) : (
                  <div className="settings-form-row settings-form-row--column">
                    <p className="settings-hint">Enter your authenticator code to confirm:</p>
                    <div className="settings-form-row">
                      <label htmlFor="totp-disable-code">Authenticator code</label>
                      <input
                        id="totp-disable-code"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        placeholder="000000"
                        value={totpDisableCode}
                        onChange={(e) => setTotpDisableCode(e.target.value)}
                        className="settings-input settings-input--narrow"
                        autoComplete="one-time-code"
                      />
                    </div>
                    <div className="settings-form-row">
                      <button
                        className="settings-btn settings-btn--danger"
                        onClick={handleTotpDisable}
                        disabled={totpDisableCode.length !== 6}
                      >
                        Confirm Disable
                      </button>
                      <button
                        className="settings-btn"
                        onClick={() => { setShowDisableConfirm(false); setTotpDisableCode(""); setTotpMessage(null); }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {totp.status === "setup" && (
              <div className="settings-form-row settings-form-row--column">
                <p className="settings-hint">
                  Scan this QR code with your authenticator app, then enter the 6-digit code to activate.
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={totp.qrCode} alt="TOTP QR code" style={{ width: 180, height: 180, imageRendering: "pixelated" }} />
                <p className="settings-hint">
                  Manual key: <code style={{ userSelect: "all" }}>{totp.secret}</code>
                </p>
                <div className="settings-form-row">
                  <label htmlFor="totp-code">Verification code</label>
                  <input
                    id="totp-code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    className="settings-input settings-input--narrow"
                    autoComplete="one-time-code"
                  />
                </div>
                <button className="settings-save-btn" onClick={handleTotpEnable} disabled={totpCode.length !== 6}>
                  Enable 2FA
                </button>
              </div>
            )}

            {totpMessage && (
              <p className="settings-hint">{totpMessage}</p>
            )}
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
                    <tr key={svc.name}>
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
