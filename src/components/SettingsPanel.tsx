"use client";

// Register all integration widgets into the client-side registry.
import "@/integrations";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KokpitConfig, Service, Group, BookmarkGroup } from "@/config/schema";
import {
  resolveServiceSize,
  resolveGroupOrder,
  serviceNameUniquenessKey,
} from "@/config";
import { getWidgetSizeHints } from "@/widgets";
import ServiceForm from "./ServiceForm";
import GroupsTab from "./GroupsTab";
import BookmarksTab from "./BookmarksTab";
import BookmarkGroupForm from "./BookmarkGroupForm";
import { sizeLabel } from "./settingsSizeOptions";

type Tab =
  | "appearance"
  | "layout"
  | "groups"
  | "services"
  | "bookmarks"
  | "auth";

type TotpState =
  | { status: "loading" }
  | { status: "enabled" }
  | { status: "setup"; secret: string; qrCode: string }
  | { status: "error" };
type SaveStatus = "idle" | "saving" | "saved" | "error";

const THEMES = ["dark", "light", "oled", "high-contrast"] as const;

/** A staged group edit whose effect on services/bookmarks is applied at save. */
type GroupCascadeOp =
  | { type: "rename"; from: string; to: string }
  | { type: "delete"; name: string };

/**
 * Applies staged group ops (in order) to the current services and bookmarks,
 * producing cascaded copies. A rename rewrites every matching `service.group`
 * and `bookmark.placement.group`; a delete clears those references (dropping an
 * emptied placement). Pure — used both for the display projection and to build
 * the Groups-save PATCH, so shared state is only mutated on a successful save.
 */
function applyGroupCascades(
  services: Service[],
  bookmarks: BookmarkGroup[],
  ops: GroupCascadeOp[]
): {
  services: Service[];
  bookmarks: BookmarkGroup[];
  servicesChanged: boolean;
  bookmarksChanged: boolean;
} {
  let svc = services;
  let bm = bookmarks;
  let servicesChanged = false;
  let bookmarksChanged = false;

  for (const op of ops) {
    const key = serviceNameUniquenessKey(
      op.type === "rename" ? op.from : op.name
    );

    svc = svc.map((s) => {
      if (!s.group || serviceNameUniquenessKey(s.group) !== key) return s;
      servicesChanged = true;
      if (op.type === "rename") return { ...s, group: op.to };
      const { group: _group, ...rest } = s;
      return rest;
    });

    bm = bm.map((b) => {
      if (!b.placement?.group || serviceNameUniquenessKey(b.placement.group) !== key)
        return b;
      bookmarksChanged = true;
      if (op.type === "rename") {
        return { ...b, placement: { ...b.placement, group: op.to } };
      }
      const { group: _group, ...restPlacement } = b.placement;
      const placement =
        Object.keys(restPlacement).length > 0 ? restPlacement : undefined;
      return { ...b, placement };
    });
  }

  return { services: svc, bookmarks: bm, servicesChanged, bookmarksChanged };
}

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
  const [showRecoveryConfirm, setShowRecoveryConfirm] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [newRecoveryCode, setNewRecoveryCode] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [recoveryPending, setRecoveryPending] = useState(false);

  // Services
  const [services, setServices] = useState<Service[]>(config.services);
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // Groups
  const [groups, setGroups] = useState<Group[]>(config.groups ?? []);
  const [ungrouped, setUngrouped] = useState<"first" | "last">(
    config.layout.ungrouped ?? "last"
  );
  // A group rename/delete must cascade into services and bookmark placements.
  // These edits are staged as ordered ops and only applied to the shared
  // services/bookmarks state when the Groups tab is saved — so a save on the
  // Services or Bookmarks tab can never persist a half-applied cascade (services
  // pointing at a renamed group whose `groups` entry was never committed).
  const [pendingGroupOps, setPendingGroupOps] = useState<GroupCascadeOp[]>([]);

  // Bookmarks
  const [bookmarks, setBookmarks] = useState<BookmarkGroup[]>(
    config.bookmarks ?? []
  );
  const [showBookmarkForm, setShowBookmarkForm] = useState(false);
  const [editingBookmarkIndex, setEditingBookmarkIndex] = useState<number | null>(
    null
  );

  // Per-tab save status
  const [saveStatus, setSaveStatus] = useState<Record<Tab, SaveStatus>>({
    appearance: "idle",
    layout: "idle",
    groups: "idle",
    auth: "idle",
    services: "idle",
    bookmarks: "idle",
  });

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  async function fetchTotpStatus() {
    setTotp({ status: "loading" });
    setTotpMessage(null);
    try {
      const res = await fetch("/api/auth/totp/setup");
      if (!res.ok) { totpFetchedRef.current = false; setTotp({ status: "error" }); return; }
      const json = await res.json();
      if (json.enabled) {
        setTotp({ status: "enabled" });
      } else {
        setTotp({ status: "setup", secret: json.secret, qrCode: json.qrCode });
      }
      totpFetchedRef.current = true;
    } catch {
      totpFetchedRef.current = false;
      setTotp({ status: "error" });
    }
  }

  const totpFetchedRef = useRef(false);
  useEffect(() => {
    if (activeTab === "auth" && !totpFetchedRef.current) {
      fetchTotpStatus();
    }
  }, [activeTab]);

  async function handleTotpEnable() {
    if (totp.status !== "setup") return;
    setTotpMessage(null);
    try {
      const res = await fetch("/api/auth/totp/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: totp.secret, code: totpCode }),
      });
      if (res.ok) {
        setTotpCode("");
        await fetchTotpStatus();
        setTotpMessage("2FA enabled successfully.");
      } else {
        const json = await res.json().catch(() => ({}));
        setTotpMessage((json as { error?: string }).error ?? "Failed to enable 2FA");
      }
    } catch {
      setTotpMessage("Failed to enable 2FA");
    }
  }

  async function handleTotpDisable() {
    setTotpMessage(null);
    try {
      const res = await fetch("/api/auth/totp/setup", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: totpDisableCode }),
      });
      if (res.ok) {
        setTotpDisableCode("");
        setShowDisableConfirm(false);
        await fetchTotpStatus();
        setTotpMessage("2FA disabled.");
      } else {
        const json = await res.json().catch(() => ({}));
        setTotpMessage((json as { error?: string }).error ?? "Failed to disable 2FA");
      }
    } catch {
      setTotpMessage("Failed to disable 2FA");
    }
  }

  async function handleRegenerateRecoveryCode() {
    if (recoveryPending) return;
    setRecoveryPending(true);
    setRecoveryMessage(null);
    try {
      const res = await fetch("/api/auth/recovery-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: recoveryPassword }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setRecoveryPassword("");
        setShowRecoveryConfirm(false);
        setNewRecoveryCode(json.recoveryCode);
      } else {
        setRecoveryMessage((json as { error?: string }).error ?? "Failed to generate recovery code");
      }
    } catch {
      setRecoveryMessage("Failed to generate recovery code");
    } finally {
      setRecoveryPending(false);
    }
  }

  async function saveRaw(section: Tab, payload: Record<string, unknown>) {
    setSaveStatus((s) => ({ ...s, [section]: "saving" }));
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaveStatus((s) => ({ ...s, [section]: "saved" }));
      startTransition(() => router.refresh());
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveStatus((s) => ({ ...s, [section]: "idle" })), 2000);
      return true;
    } catch {
      setSaveStatus((s) => ({ ...s, [section]: "error" }));
      return false;
    }
  }

  function save(section: Tab, data: unknown) {
    return saveRaw(section, { [section]: data });
  }

  // Layout PATCH requires columns + row_height; ungrouped (edited on the Groups
  // tab) is folded in so a layout save never drops it. Omitted when "last"
  // (the default) so YAML round-trips stay clean and unchanged configs don't
  // gain the key.
  function buildLayoutPayload() {
    function parseViewport(cols: string, rh: string) {
      const c = parseInt(cols);
      const r = parseInt(rh);
      const obj: Record<string, number> = {};
      if (!isNaN(c) && c > 0) obj.columns = c;
      if (!isNaN(r) && r > 0) obj.row_height = r;
      return Object.keys(obj).length > 0 ? obj : undefined;
    }
    return {
      columns,
      row_height: rowHeight,
      ungrouped: ungrouped === "first" ? ("first" as const) : undefined,
      tablet: parseViewport(tabletColumns, tabletRowHeight),
      mobile: parseViewport(mobileColumns, mobileRowHeight),
    };
  }

  function handleThemeSelect(t: typeof THEMES[number]) {
    setTheme(t);
    document.documentElement.dataset.theme = t;
  }

  function handleSaveAppearance() {
    save("appearance", { theme, custom_css: customCss || undefined });
  }

  function handleSaveLayout() {
    save("layout", buildLayoutPayload());
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

  function handleServiceReorder(from: number, to: number) {
    if (to < 0 || to >= services.length) return;
    const next = [...services];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setServices(next);
    save("services", next);
  }

  function effectiveSize(svc: Service) {
    const preferred = svc.widget
      ? getWidgetSizeHints(svc.widget.type)?.preferredSize
      : undefined;
    return resolveServiceSize(svc, preferred);
  }

  // ----- Groups tab -----

  const declaredKeys = useMemo(
    () => new Set(groups.map((g) => serviceNameUniquenessKey(g.name))),
    [groups]
  );

  // Services/bookmarks as they WILL look once the staged group ops are applied.
  // Drives the undeclared-group detection so a group pending rename/delete
  // doesn't spuriously reappear as "undeclared" while its cascade is unsaved.
  const projectedCascade = useMemo(
    () => applyGroupCascades(services, bookmarks, pendingGroupOps),
    [services, bookmarks, pendingGroupOps]
  );

  const undeclaredGroups = useMemo(
    () =>
      resolveGroupOrder({
        layout: config.layout,
        services: projectedCascade.services,
        groups,
        bookmarks: projectedCascade.bookmarks,
      })
        .filter((g) => g.name !== null && !g.declared)
        .map((g) => g.name as string),
    [config.layout, projectedCascade, groups]
  );

  const knownGroupNames = useMemo(() => {
    const names: string[] = [...groups.map((g) => g.name), ...undeclaredGroups];
    const seen = new Set<string>();
    return names.filter((n) => {
      const key = serviceNameUniquenessKey(n);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [groups, undeclaredGroups]);

  function handleGroupReorder(from: number, to: number) {
    if (to < 0 || to >= groups.length) return;
    const next = [...groups];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setGroups(next);
  }

  function handleGroupDeclare(name: string) {
    if (declaredKeys.has(serviceNameUniquenessKey(name))) return;
    setGroups((prev) => [...prev, { name }]);
  }

  function handleGroupAdd(name: string) {
    if (declaredKeys.has(serviceNameUniquenessKey(name))) return;
    setGroups((prev) => [...prev, { name }]);
  }

  function handleGroupRename(oldName: string, newName: string) {
    const oldKey = serviceNameUniquenessKey(oldName);
    setGroups((prev) =>
      prev.map((g) =>
        serviceNameUniquenessKey(g.name) === oldKey ? { ...g, name: newName } : g
      )
    );
    // Stage the cascade; it's applied to services/bookmarks only on Groups save.
    setPendingGroupOps((prev) => [
      ...prev,
      { type: "rename", from: oldName, to: newName },
    ]);
  }

  function handleGroupToggleCollapsed(index: number) {
    setGroups((prev) =>
      prev.map((g, i) =>
        i === index ? { ...g, collapsed: !(g.collapsed ?? false) } : g
      )
    );
  }

  function handleGroupColumnsChange(index: number, columns: number | undefined) {
    setGroups((prev) =>
      prev.map((g, i) => (i === index ? { ...g, columns } : g))
    );
  }

  function handleGroupDelete(index: number) {
    const removed = groups[index];
    setGroups((prev) => prev.filter((_, i) => i !== index));
    // Members become ungrouped and bookmark placements are cleared — but only
    // once the Groups tab is saved (staged as an op, applied at save time).
    setPendingGroupOps((prev) => [...prev, { type: "delete", name: removed.name }]);
  }

  async function handleSaveGroups() {
    // Strip default values so omitted keys stay omitted in the YAML round-trip.
    const cleanGroups = groups.map((g) => ({
      name: g.name,
      ...(g.collapsed ? { collapsed: true } : {}),
      ...(g.columns ? { columns: g.columns } : {}),
    }));
    // Apply the staged cascade to the CURRENT services/bookmarks so the PATCH
    // carries the renamed/cleared references atomically with the `groups` write.
    const cascade = applyGroupCascades(services, bookmarks, pendingGroupOps);
    const payload: Record<string, unknown> = {
      groups: cleanGroups,
      layout: buildLayoutPayload(),
    };
    if (cascade.servicesChanged) payload.services = cascade.services;
    if (cascade.bookmarksChanged) payload.bookmarks = cascade.bookmarks;
    const ok = await saveRaw("groups", payload);
    if (ok) {
      // Now — and only now — reflect the cascade in shared state and clear ops.
      if (cascade.servicesChanged) setServices(cascade.services);
      if (cascade.bookmarksChanged) setBookmarks(cascade.bookmarks);
      setPendingGroupOps([]);
    }
  }

  // ----- Bookmarks tab -----

  function handleBookmarkReorder(from: number, to: number) {
    if (to < 0 || to >= bookmarks.length) return;
    const next = [...bookmarks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setBookmarks(next);
    save("bookmarks", next);
  }

  function handleBookmarkDelete(index: number) {
    const next = bookmarks.filter((_, i) => i !== index);
    setBookmarks(next);
    save("bookmarks", next);
  }

  function openAddBookmark() {
    setEditingBookmarkIndex(null);
    setShowBookmarkForm(true);
  }

  function openEditBookmark(index: number) {
    setEditingBookmarkIndex(index);
    setShowBookmarkForm(true);
  }

  function handleBookmarkSave(bookmark: BookmarkGroup) {
    const next = [...bookmarks];
    if (editingBookmarkIndex !== null) {
      next[editingBookmarkIndex] = bookmark;
    } else {
      next.push(bookmark);
    }
    setBookmarks(next);
    setShowBookmarkForm(false);
    setEditingBookmarkIndex(null);
    save("bookmarks", next);
  }

  function closeBookmarkForm() {
    setShowBookmarkForm(false);
    setEditingBookmarkIndex(null);
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
        {(["appearance", "layout", "groups", "services", "bookmarks", "auth"] as Tab[]).map((tab) => (
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

            <h3 className="settings-section__subtitle">Password Recovery</h3>

            {newRecoveryCode ? (
              <div className="settings-form-row settings-form-row--column">
                <p className="settings-hint">
                  Save this code now — it will not be shown again. Your previous
                  recovery code no longer works.
                </p>
                <code style={{ userSelect: "all", padding: "0.5rem", border: "1px solid currentColor", borderRadius: "4px" }}>
                  {newRecoveryCode}
                </code>
                <button className="settings-btn" onClick={() => setNewRecoveryCode(null)}>
                  Done
                </button>
              </div>
            ) : !showRecoveryConfirm ? (
              <div className="settings-form-row settings-form-row--column">
                <p className="settings-hint">
                  Your recovery code lets you reset your password from the login
                  page without an email address. Generating a new one invalidates
                  the old one.
                </p>
                <button className="settings-btn" onClick={() => { setShowRecoveryConfirm(true); setRecoveryMessage(null); }}>
                  Generate new recovery code
                </button>
              </div>
            ) : (
              <div className="settings-form-row settings-form-row--column">
                <p className="settings-hint">Enter your current password to confirm:</p>
                <div className="settings-form-row">
                  <label htmlFor="recovery-password">Password</label>
                  <input
                    id="recovery-password"
                    type="password"
                    value={recoveryPassword}
                    onChange={(e) => setRecoveryPassword(e.target.value)}
                    className="settings-input"
                    autoComplete="current-password"
                  />
                </div>
                <div className="settings-form-row">
                  <button
                    className="settings-save-btn"
                    onClick={handleRegenerateRecoveryCode}
                    disabled={!recoveryPassword || recoveryPending}
                  >
                    {recoveryPending ? "Generating…" : "Confirm"}
                  </button>
                  <button
                    className="settings-btn"
                    onClick={() => { setShowRecoveryConfirm(false); setRecoveryPassword(""); setRecoveryMessage(null); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {recoveryMessage && (
              <p className="settings-hint">{recoveryMessage}</p>
            )}
          </section>
        )}

        {/* GROUPS */}
        {activeTab === "groups" && (
          <GroupsTab
            groups={groups}
            undeclaredGroups={undeclaredGroups}
            ungrouped={ungrouped}
            saveStatus={saveStatus.groups}
            onReorder={handleGroupReorder}
            onRename={handleGroupRename}
            onToggleCollapsed={handleGroupToggleCollapsed}
            onColumnsChange={handleGroupColumnsChange}
            onDelete={handleGroupDelete}
            onDeclare={handleGroupDeclare}
            onAdd={handleGroupAdd}
            onUngroupedChange={setUngrouped}
            onSave={handleSaveGroups}
          />
        )}

        {/* BOOKMARKS */}
        {activeTab === "bookmarks" && (
          <BookmarksTab
            bookmarks={bookmarks}
            saveStatus={saveStatus.bookmarks}
            onReorder={handleBookmarkReorder}
            onEdit={openEditBookmark}
            onDelete={handleBookmarkDelete}
            onAdd={openAddBookmark}
          />
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
                    <th>Order</th>
                    <th>Name</th>
                    <th>URL</th>
                    <th>Group</th>
                    <th>Size</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((svc, i) => (
                    <tr key={svc.name}>
                      <td className="service-table__reorder">
                        <button
                          className="settings-icon-btn"
                          aria-label={`Move ${svc.name} up`}
                          disabled={i === 0}
                          onClick={() => handleServiceReorder(i, i - 1)}
                        >
                          ▲
                        </button>
                        <button
                          className="settings-icon-btn"
                          aria-label={`Move ${svc.name} down`}
                          disabled={i === services.length - 1}
                          onClick={() => handleServiceReorder(i, i + 1)}
                        >
                          ▼
                        </button>
                      </td>
                      <td>{svc.name}</td>
                      <td className="service-table__url">{svc.url ?? "—"}</td>
                      <td>{svc.group ?? "—"}</td>
                      <td>{sizeLabel(effectiveSize(svc))}</td>
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
          existingGroups={knownGroupNames}
          takenNames={services
            .filter((_, i) => editingIndex === null || i !== editingIndex)
            .map((s) => s.name)}
          onSave={handleServiceSave}
          onClose={closeServiceForm}
        />
      )}

      {showBookmarkForm && (
        <BookmarkGroupForm
          bookmark={
            editingBookmarkIndex !== null ? bookmarks[editingBookmarkIndex] : null
          }
          knownGroups={knownGroupNames}
          takenNames={bookmarks
            .filter((_, i) => editingBookmarkIndex === null || i !== editingBookmarkIndex)
            .map((b) => b.name)}
          onSave={handleBookmarkSave}
          onClose={closeBookmarkForm}
        />
      )}
    </div>
  );
}
