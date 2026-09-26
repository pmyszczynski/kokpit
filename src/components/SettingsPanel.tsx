"use client";

// Register all integration widgets into the client-side registry.
import "@/integrations";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KokpitConfig, Service, Group, BookmarkGroup, widgetIntegrationRequirement } from "@/config/schema";
import type { ClientSafeSettings } from "@/widgets/clientSafeSettings";
import {
  resolveGroupOrder,
  serviceNameUniquenessKey,
} from "@/config";
import { getWidget } from "@/widgets";
import { GENERIC_SERVICE_FOOTPRINT } from "@/layout/grid";
import {
  applyGroupCascades,
  applyServiceTileGroupCascades,
  type GroupCascadeOp,
} from "@/config/groupCascade";
import ServiceForm from "./ServiceForm";
import GroupsTab from "./GroupsTab";
import BookmarksTab from "./BookmarksTab";
import BookmarkGroupForm from "./BookmarkGroupForm";
import SessionManager from "./SessionManager";
import {
  persistLegacyServices,
  projectCatalogServices,
  normalizeServicesForForm,
} from "./edit/serviceFormProjection";
import { CONFIG_REVISION_HEADER } from "@/config/revisionHeader";

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
type SaveResult = {
  ok: boolean;
  config?: Partial<KokpitConfig>;
};

const THEMES = ["dark", "light", "oled", "high-contrast"] as const;

// Parse a numeric text field and clamp it into [min, max]. Returns undefined for
// an empty/non-numeric field so "blank" still means "unset" (not 0). The browser
// doesn't enforce input min/max on typed/pasted values, so an out-of-range entry
// would otherwise be sent and rejected by the server's Zod schema with an opaque
// 400 — clamping here guarantees a valid request instead.
function clampNumericField(
  raw: string,
  min: number,
  max: number
): number | undefined {
  const n = parseFloat(raw);
  if (isNaN(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

function SaveButton({ status, onSave, disabled }: { status: SaveStatus; onSave: () => void; disabled?: boolean }) {
  return (
    <button
      className="settings-save-btn"
      onClick={onSave}
      disabled={disabled || status === "saving"}
    >
      {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : status === "error" ? "Error — Retry" : "Save"}
    </button>
  );
}

export default function SettingsPanel({
  config,
  showSessionManager = config.auth.enabled,
  initialRevision = "",
}: {
  config: ClientSafeSettings;
  showSessionManager?: boolean;
  initialRevision?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<Tab>("appearance");

  // Appearance
  const [theme, setTheme] = useState(config.appearance.theme);
  const [customCss, setCustomCss] = useState(config.appearance.custom_css ?? "");
  const [cardBlur, setCardBlur] = useState(
    config.appearance.card_blur?.toString() ?? ""
  );
  const [bgColor, setBgColor] = useState(config.appearance.background?.color ?? "");
  const [bgGradient, setBgGradient] = useState(
    config.appearance.background?.gradient ?? ""
  );
  const [bgImage, setBgImage] = useState(config.appearance.background?.image ?? "");
  const [bgBlur, setBgBlur] = useState(
    config.appearance.background?.blur?.toString() ?? ""
  );
  const [bgBrightness, setBgBrightness] = useState(
    config.appearance.background?.brightness?.toString() ?? ""
  );
  const [bgOpacity, setBgOpacity] = useState(
    config.appearance.background?.opacity?.toString() ?? ""
  );
  const [bgUploadStatus, setBgUploadStatus] = useState<{
    state: "idle" | "uploading" | "error";
    message?: string;
  }>({ state: "idle" });
  const bgFileInputRef = useRef<HTMLInputElement>(null);

  // Layout

  // Auth
  const [sessionIdleTimeout, setSessionIdleTimeout] = useState(
    config.auth.session_idle_timeout_hours && config.auth.session_idle_timeout_hours > 0
      ? config.auth.session_idle_timeout_hours.toString()
      : ""
  );
  const [authPassword, setAuthPassword] = useState("");
  const [authPolicyMessage, setAuthPolicyMessage] = useState<string | null>(null);
  const [totp, setTotp] = useState<TotpState>({ status: "loading" });
  const [totpCode, setTotpCode] = useState("");
  const [totpPassword, setTotpPassword] = useState("");
  const [totpMessage, setTotpMessage] = useState<string | null>(null);
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [totpDisableCode, setTotpDisableCode] = useState("");
  const [showRecoveryConfirm, setShowRecoveryConfirm] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [newRecoveryCode, setNewRecoveryCode] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [recoveryPending, setRecoveryPending] = useState(false);

  // Services
  const [initialServiceState] = useState(() =>
    normalizeServicesForForm(config.services, config.service_tiles ?? [])
  );
  const [persistedServices, setPersistedServices] = useState(initialServiceState.services);
  const [services, setServices] = useState<Service[]>(() =>
    projectCatalogServices(initialServiceState.services, initialServiceState.service_tiles)
  );
  const [serviceTiles, setServiceTiles] = useState(initialServiceState.service_tiles);
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [servicesWritePending, setServicesWritePending] = useState(false);

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
  const servicesSavePendingRef = useRef(false);
  // Independent drafts share this compare-and-swap token. A stale draft stays
  // blocked until the complete server snapshot is explicitly reloaded.
  const revisionRef = useRef(initialRevision);
  const writePendingRef = useRef(false);
  const conflictRef = useRef(false);
  const [writePending, setWritePending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const draftBlocked = writePending || conflict;
  const configurationMutationBlocked = () =>
    writePendingRef.current || conflictRef.current;
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
        headers: { "Content-Type": "application/json", "X-Kokpit-Request": "1" },
        body: JSON.stringify({ secret: totp.secret, code: totpCode, password: totpPassword }),
      });
      if (res.ok) {
        setTotpCode("");
        setTotpPassword("");
        await fetchTotpStatus();
        setTotpMessage("2FA enabled successfully. Other signed-in devices have been signed out.");
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
        headers: { "Content-Type": "application/json", "X-Kokpit-Request": "1" },
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
        headers: { "Content-Type": "application/json", "X-Kokpit-Request": "1" },
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

  async function saveRaw(
    section: Tab,
    payload: Record<string, unknown>
  ): Promise<SaveResult> {
    if (configurationMutationBlocked()) return { ok: false };
    writePendingRef.current = true;
    setWritePending(true);
    setSaveStatus((s) => ({ ...s, [section]: "saving" }));
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Kokpit-Request": "1",
          ...(revisionRef.current ? { "If-Match": revisionRef.current } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
        const json = await res.json().catch(() => null) as { code?: unknown; error?: string } | null;
        if (json?.code === "revision_mismatch") {
          conflictRef.current = true;
          setConflict(true);
        }
        if (section === "auth") setAuthPolicyMessage(json?.error ?? "Save failed");
        setSaveStatus((s) => ({ ...s, [section]: "error" }));
        return { ok: false };
      }
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        if (section === "auth") setAuthPolicyMessage(json.error ?? "Save failed");
        throw new Error("Save failed");
      }
      const nextRevision = res.headers?.get(CONFIG_REVISION_HEADER) ?? null;
      if (nextRevision) revisionRef.current = nextRevision;
      // A services response contains freshly redacted credential references.
      // Those references identify the service by name, so a rename must replace
      // the optimistic client state with this authoritative response before the
      // next services edit is submitted.
      let updatedConfig: Partial<KokpitConfig> | undefined;
      try {
        const json: unknown = await res.json();
        if (json !== null && typeof json === "object") {
          updatedConfig = json as Partial<KokpitConfig>;
        }
      } catch {
        // The API returns JSON, but a malformed success response must not turn
        // an already-persisted settings change into a client-side save failure.
      }
      setSaveStatus((s) => ({ ...s, [section]: "saved" }));
      startTransition(() => router.refresh());
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveStatus((s) => ({ ...s, [section]: "idle" })), 2000);
      return { ok: true, config: updatedConfig };
    } catch {
      setSaveStatus((s) => ({ ...s, [section]: "error" }));
      return { ok: false };
    } finally {
      writePendingRef.current = false;
      setWritePending(false);
    }
  }

  function save(section: Tab, data: unknown) {
    return saveRaw(section, { [section]: data });
  }

  // Geometry is application-owned. Only organizational layout state persists.
  function buildLayoutPayload() {
    return {
      ungrouped: ungrouped === "first" ? ("first" as const) : undefined,
    };
  }

  function handleThemeSelect(t: typeof THEMES[number]) {
    if (configurationMutationBlocked()) return;
    setTheme(t);
    document.documentElement.dataset.theme = t;
  }

  function buildBackgroundPayload() {
    const obj: Record<string, unknown> = {};
    if (bgColor.trim()) obj.color = bgColor.trim();
    if (bgGradient.trim()) obj.gradient = bgGradient.trim();
    if (bgImage.trim()) obj.image = bgImage.trim();
    // Clamp each numeric to its documented range so a typed/pasted out-of-range
    // value is corrected rather than rejected by the server. Empty stays unset.
    const blur = clampNumericField(bgBlur, 0, 100);
    if (blur !== undefined) obj.blur = blur;
    const brightness = clampNumericField(bgBrightness, 0, 1);
    if (brightness !== undefined) obj.brightness = brightness;
    const opacity = clampNumericField(bgOpacity, 0, 1);
    if (opacity !== undefined) obj.opacity = opacity;
    return Object.keys(obj).length > 0 ? obj : undefined;
  }

  function handleSaveAppearance() {
    // Clamp to the documented 0–40 range; 0/blank still means "unset" (cards
    // stay opaque), matching the pre-clamp behavior.
    const cb = clampNumericField(cardBlur, 0, 40);
    save("appearance", {
      theme,
      custom_css: customCss || undefined,
      card_blur: cb !== undefined && cb > 0 ? cb : undefined,
      background: buildBackgroundPayload(),
    });
  }

  async function handleBackgroundUpload(file: File) {
    if (configurationMutationBlocked()) return;
    setBgUploadStatus({ state: "uploading" });
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/backgrounds/upload", { method: "POST", body });
      const json = (await res.json()) as { path?: string; error?: string };
      if (!res.ok || !json.path) {
        setBgUploadStatus({ state: "error", message: json.error ?? "Upload failed" });
        return;
      }
      setBgImage(json.path);
      setBgUploadStatus({ state: "idle" });
    } catch (err) {
      setBgUploadStatus({
        state: "error",
        message: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }

  function handleSaveAuth() {
    const submittedTimeout = sessionIdleTimeout;
    const timeout = Number(submittedTimeout);
    const canonicalTimeout = Number.isFinite(timeout) && timeout > 0
      ? Math.min(8760, Math.max(1, Math.floor(timeout)))
      : 0;
    setAuthPolicyMessage(null);
    void saveRaw("auth", {
      auth: {
        enabled: config.auth.enabled,
        session_idle_timeout_hours: canonicalTimeout,
      },
      auth_password: authPassword,
    }).then((result) => {
      if (!result.ok) return;
      setAuthPassword("");
      const savedTimeout = result.config?.auth?.session_idle_timeout_hours ?? canonicalTimeout;
      setSessionIdleTimeout((current) => current === submittedTimeout
        ? (savedTimeout > 0 ? savedTimeout.toString() : "")
        : current);
    });
  }

  async function saveServices(next: Service[]) {
    if (servicesSavePendingRef.current || configurationMutationBlocked()) return;
    const projected = persistLegacyServices(next, persistedServices, serviceTiles);
    servicesSavePendingRef.current = true;
    setServicesWritePending(true);
    setServices(next);
    setPersistedServices(projected.services);
    setServiceTiles(projected.service_tiles);
    try {
      const result = await saveRaw("services", projected);
      if (Array.isArray(result.config?.services)) {
        const refreshed = normalizeServicesForForm(
          result.config.services,
          Array.isArray(result.config.service_tiles) ? result.config.service_tiles : []
        );
        setServices(projectCatalogServices(refreshed.services, refreshed.service_tiles));
        setPersistedServices(refreshed.services);
        setServiceTiles(refreshed.service_tiles);
      }
    } finally {
      servicesSavePendingRef.current = false;
      setServicesWritePending(false);
    }
  }

  function handleServiceSave(service: Service) {
    if (servicesSavePendingRef.current || configurationMutationBlocked()) return;
    const next = [...services];
    if (editingIndex !== null) {
      next[editingIndex] = service;
    } else {
      next.push(service);
    }
    setShowServiceForm(false);
    setEditingIndex(null);
    void saveServices(next);
  }

  function handleServiceDelete(index: number) {
    if (servicesSavePendingRef.current || configurationMutationBlocked()) return;
    const next = services.filter((_, i) => i !== index);
    void saveServices(next);
  }

  function handleServiceReorder(from: number, to: number) {
    if (servicesSavePendingRef.current || configurationMutationBlocked()) return;
    if (to < 0 || to >= services.length) return;
    const next = [...services];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void saveServices(next);
  }

  function effectiveFootprint(svc: Service) {
    return svc.footprint ??
      (svc.widget ? getWidget(svc.widget.type)?.supportedFootprints?.[0] : undefined) ??
      GENERIC_SERVICE_FOOTPRINT;
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
  const projectedTiles = useMemo(
    () => applyServiceTileGroupCascades(serviceTiles, pendingGroupOps),
    [serviceTiles, pendingGroupOps]
  );

  const undeclaredGroups = useMemo(
    () =>
      resolveGroupOrder({
        layout: config.layout,
        service_tiles: projectedTiles.serviceTiles,
        groups,
        bookmarks: projectedCascade.bookmarks,
      })
        .filter((g) => g.name !== null && !g.declared)
        .map((g) => g.name as string),
    [config.layout, projectedTiles, projectedCascade, groups]
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
    if (configurationMutationBlocked()) return;
    if (to < 0 || to >= groups.length) return;
    const next = [...groups];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setGroups(next);
  }

  function handleGroupDeclare(name: string) {
    if (configurationMutationBlocked()) return;
    if (declaredKeys.has(serviceNameUniquenessKey(name))) return;
    setGroups((prev) => [...prev, { name }]);
  }

  function handleGroupAdd(name: string) {
    if (configurationMutationBlocked()) return;
    if (declaredKeys.has(serviceNameUniquenessKey(name))) return;
    setGroups((prev) => [...prev, { name }]);
  }

  function handleGroupRename(oldName: string, newName: string) {
    if (configurationMutationBlocked()) return;
    const oldKey = serviceNameUniquenessKey(oldName);
    const newKey = serviceNameUniquenessKey(newName);
    // Reject a rename that would collide with ANOTHER declared group (the
    // GroupsSchema would reject the whole save otherwise, and it clashes with
    // key={g.name}). A letter-case-only change of the same group (newKey ===
    // oldKey) is allowed. Silent no-op, matching add/declare's duplicate guard.
    if (
      newKey !== oldKey &&
      groups.some((g) => serviceNameUniquenessKey(g.name) === newKey)
    ) {
      return;
    }
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
    if (configurationMutationBlocked()) return;
    setGroups((prev) =>
      prev.map((g, i) =>
        i === index ? { ...g, collapsed: !(g.collapsed ?? false) } : g
      )
    );
  }

  function handleGroupDelete(index: number) {
    if (configurationMutationBlocked()) return;
    const removed = groups[index];
    setGroups((prev) => prev.filter((_, i) => i !== index));
    // Members become ungrouped and bookmark placements are cleared — but only
    // once the Groups tab is saved (staged as an op, applied at save time).
    setPendingGroupOps((prev) => [...prev, { type: "delete", name: removed.name }]);
  }

  async function handleSaveGroups() {
    // Group renames/deletes may cascade into the complete services array.
    // Never let that full-list write race a service save carrying older
    // credential references.
    if (servicesSavePendingRef.current || configurationMutationBlocked()) return;
    // Strip default values so omitted keys stay omitted in the YAML round-trip.
    const cleanGroups = groups.map((g) => ({
      name: g.name,
      ...(g.collapsed ? { collapsed: true } : {}),
    }));
    // Apply the staged cascade to the CURRENT services/bookmarks so the PATCH
    // carries the renamed/cleared references atomically with the `groups` write.
    const cascade = applyGroupCascades(services, bookmarks, pendingGroupOps);
    const tileCascade = applyServiceTileGroupCascades(serviceTiles, pendingGroupOps);
    const payload: Record<string, unknown> = {
      groups: cleanGroups,
      layout: buildLayoutPayload(),
    };
    if (tileCascade.serviceTilesChanged) payload.service_tiles = tileCascade.serviceTiles;
    if (cascade.bookmarksChanged) payload.bookmarks = cascade.bookmarks;
    if (tileCascade.serviceTilesChanged) {
      servicesSavePendingRef.current = true;
      setServicesWritePending(true);
    }
    try {
      const result = await saveRaw("groups", payload);
      if (result.ok) {
        // Now — and only now — reflect the cascade in shared state and clear ops.
        if (tileCascade.serviceTilesChanged) {
          const fallback = persistLegacyServices(
            cascade.services,
            persistedServices,
            tileCascade.serviceTiles
          );
          const refreshed = normalizeServicesForForm(
            Array.isArray(result.config?.services) ? result.config.services : fallback.services,
            Array.isArray(result.config?.service_tiles)
              ? result.config.service_tiles
              : fallback.service_tiles
          );
          setServices(projectCatalogServices(refreshed.services, refreshed.service_tiles));
          setPersistedServices(refreshed.services);
          setServiceTiles(refreshed.service_tiles);
        }
        if (cascade.bookmarksChanged) setBookmarks(cascade.bookmarks);
        setPendingGroupOps([]);
      }
    } finally {
      if (tileCascade.serviceTilesChanged) {
        servicesSavePendingRef.current = false;
        setServicesWritePending(false);
      }
    }
  }

  // ----- Bookmarks tab -----

  function handleBookmarkReorder(from: number, to: number) {
    if (configurationMutationBlocked()) return;
    if (to < 0 || to >= bookmarks.length) return;
    const next = [...bookmarks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setBookmarks(next);
    save("bookmarks", next);
  }

  function handleBookmarkDelete(index: number) {
    if (configurationMutationBlocked()) return;
    const next = bookmarks.filter((_, i) => i !== index);
    setBookmarks(next);
    save("bookmarks", next);
  }

  function openAddBookmark() {
    if (configurationMutationBlocked()) return;
    setEditingBookmarkIndex(null);
    setShowBookmarkForm(true);
  }

  function openEditBookmark(index: number) {
    if (configurationMutationBlocked()) return;
    setEditingBookmarkIndex(index);
    setShowBookmarkForm(true);
  }

  function handleBookmarkSave(bookmark: BookmarkGroup) {
    if (configurationMutationBlocked()) return;
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
    if (servicesSavePendingRef.current || configurationMutationBlocked()) return;
    setEditingIndex(null);
    setShowServiceForm(true);
  }

  function openEditForm(index: number) {
    if (servicesSavePendingRef.current || configurationMutationBlocked()) return;
    setEditingIndex(index);
    setShowServiceForm(true);
  }

  function closeServiceForm() {
    setShowServiceForm(false);
    setEditingIndex(null);
  }

  return (
    <div className="settings-panel">
      {conflict && (
        <div className="settings-form-hint settings-form-hint--error" role="alert">
          settings.yaml changed on disk. Reload to discard this draft and review the latest settings.
          <button className="settings-btn" onClick={() => window.location.reload()}>
            Reload settings
          </button>
        </div>
      )}
      <nav className="settings-tabs" aria-label="Settings sections">
        {(["appearance", "layout", "groups", "services", "bookmarks", "auth"] as Tab[]).map((tab) => (
          <button
            key={tab}
            className={`settings-tab${activeTab === tab ? " settings-tab--active" : ""}`}
            onClick={() => setActiveTab(tab)}
            disabled={servicesWritePending}
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
            <fieldset className="settings-section settings-fieldset" disabled={draftBlocked}>

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
                onChange={(e) => { if (!configurationMutationBlocked()) setCustomCss(e.target.value); }}
                placeholder=".service-tile { border-radius: 0; }"
                rows={8}
              />
              <span className="settings-hint">
                Injected last — no !important needed.
              </span>
            </div>

            <div className="settings-form-row">
              <label htmlFor="card-blur">Card blur (px)</label>
              <input
                id="card-blur"
                type="number"
                min={0}
                max={40}
                value={cardBlur}
                onChange={(e) => { if (!configurationMutationBlocked()) setCardBlur(e.target.value); }}
                className="settings-input settings-input--narrow"
                placeholder="0"
              />
            </div>
            <span className="settings-hint">
              Frosted-glass effect on cards. 0 or blank keeps cards opaque.
            </span>

            <div className="settings-form-row settings-form-row--column">
              <label>Background</label>
              <span className="settings-hint">
                Set a color, gradient, or image. If more than one is set, image
                wins, then gradient, then color.
              </span>
            </div>

            <div className="settings-form-row">
              <label htmlFor="bg-color">Color</label>
              <input
                id="bg-color"
                type="text"
                value={bgColor}
                onChange={(e) => { if (!configurationMutationBlocked()) setBgColor(e.target.value); }}
                className="settings-input"
                placeholder="#0b0d12"
              />
            </div>

            <div className="settings-form-row">
              <label htmlFor="bg-gradient">Gradient</label>
              <input
                id="bg-gradient"
                type="text"
                value={bgGradient}
                onChange={(e) => { if (!configurationMutationBlocked()) setBgGradient(e.target.value); }}
                className="settings-input"
                placeholder="linear-gradient(135deg, #1e3a8a, #0f172a)"
              />
            </div>

            <div className="settings-form-row">
              <label htmlFor="bg-image">Image URL / path</label>
              <input
                id="bg-image"
                type="text"
                value={bgImage}
                onChange={(e) => { if (!configurationMutationBlocked()) setBgImage(e.target.value); }}
                className="settings-input"
                placeholder="/api/backgrounds/user/… or https://…"
              />
            </div>

            <div className="settings-actions settings-actions--spaced">
              <button
                type="button"
                className="settings-btn"
                onClick={() => bgFileInputRef.current?.click()}
                disabled={bgUploadStatus.state === "uploading"}
              >
                {bgUploadStatus.state === "uploading" ? "Uploading…" : "Upload image"}
              </button>
              <input
                ref={bgFileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleBackgroundUpload(f);
                  e.target.value = "";
                }}
              />
              {bgUploadStatus.state === "error" && (
                <span className="settings-save-feedback settings-save-feedback--error">
                  {bgUploadStatus.message}
                </span>
              )}
            </div>

            <div className="settings-form-row">
              <label htmlFor="bg-blur">Image blur (px)</label>
              <input
                id="bg-blur"
                type="number"
                min={0}
                max={100}
                value={bgBlur}
                onChange={(e) => { if (!configurationMutationBlocked()) setBgBlur(e.target.value); }}
                className="settings-input settings-input--narrow"
                placeholder="0"
              />
            </div>
            <div className="settings-form-row">
              <label htmlFor="bg-brightness">Brightness (0–1)</label>
              <input
                id="bg-brightness"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={bgBrightness}
                onChange={(e) => { if (!configurationMutationBlocked()) setBgBrightness(e.target.value); }}
                className="settings-input settings-input--narrow"
                placeholder="1"
              />
            </div>
            <div className="settings-form-row">
              <label htmlFor="bg-opacity">Overlay opacity (0–1)</label>
              <input
                id="bg-opacity"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={bgOpacity}
                onChange={(e) => { if (!configurationMutationBlocked()) setBgOpacity(e.target.value); }}
                className="settings-input settings-input--narrow"
                placeholder="0"
              />
            </div>

            <div className="settings-actions">
              <SaveButton status={saveStatus.appearance} onSave={handleSaveAppearance} disabled={draftBlocked} />
            </div>
            </fieldset>
          </section>
        )}

        {/* LAYOUT */}
        {activeTab === "layout" && (
          <section className="settings-section">
            <h2 className="settings-section__title">Layout</h2>

            <p className="settings-hint">
              Tile geometry is fixed at 108 × 60 px units with an 8 px gap.
              The viewport automatically selects 3, 6, 9, 12, or 15 columns.
            </p>
          </section>
        )}

        {/* AUTH */}
        {activeTab === "auth" && (
          <section className="settings-section">
            <h2 className="settings-section__title">Authentication</h2>

            <div className="settings-form-row settings-form-row--column">
              <label className="settings-form-row">
                <input
                  type="checkbox"
                  checked={!sessionIdleTimeout}
                  disabled={draftBlocked}
                  onChange={(event) => {
                    if (!configurationMutationBlocked()) setSessionIdleTimeout(event.target.checked ? "" : "24");
                  }}
                />
                Stay signed in
              </label>
              {!sessionIdleTimeout && <span className="settings-hint">Sessions stay signed in until you sign out or revoke them.</span>}
              <div className="settings-form-row flex-wrap">
                <label htmlFor="session-idle-timeout">Sign out after inactivity (hours)</label>
                <input
                  id="session-idle-timeout"
                  type="number"
                  min={1}
                  max={8760}
                  value={sessionIdleTimeout}
                  disabled={draftBlocked || !sessionIdleTimeout}
                  onChange={(event) => {
                    if (!configurationMutationBlocked()) setSessionIdleTimeout(event.target.value);
                  }}
                  className="settings-input settings-input--narrow"
                />
                <button
                  className="settings-btn"
                  onClick={() => { if (!configurationMutationBlocked()) setSessionIdleTimeout("24"); }}
                  disabled={draftBlocked || !!sessionIdleTimeout}
                >Use inactivity timeout</button>
              </div>
              <span className="settings-hint">This policy applies to new sessions only. Existing sessions are unaffected. Dashboard and widget requests, including polling, count as activity; background cookie renewal does not.</span>
              {config.auth.enabled && (
                <div className="settings-form-row">
                  <label htmlFor="auth-policy-password">Current password</label>
                  <input
                    id="auth-policy-password"
                    type="password"
                    value={authPassword}
                    disabled={draftBlocked}
                    onChange={(event) => { if (!configurationMutationBlocked()) setAuthPassword(event.target.value); }}
                    className="settings-input"
                    autoComplete="current-password"
                  />
                </div>
              )}
            </div>

            <div className="settings-actions">
              <SaveButton status={saveStatus.auth} onSave={handleSaveAuth} disabled={draftBlocked} />
            </div>
            {authPolicyMessage && <p className="settings-hint" role="alert">{authPolicyMessage}</p>}

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
                <div className="settings-form-row">
                  <label htmlFor="totp-password">Current password</label>
                  <input id="totp-password" type="password" value={totpPassword} onChange={(event) => setTotpPassword(event.target.value)} className="settings-input" autoComplete="current-password" />
                </div>
                <button className="settings-save-btn" onClick={handleTotpEnable} disabled={totpCode.length !== 6 || !totpPassword}>
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

            {showSessionManager && <SessionManager />}
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
            onDelete={handleGroupDelete}
            onDeclare={handleGroupDeclare}
            onAdd={handleGroupAdd}
            onUngroupedChange={(value) => {
              if (!configurationMutationBlocked()) setUngrouped(value);
            }}
            onSave={handleSaveGroups}
            disabled={draftBlocked}
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
            disabled={draftBlocked}
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
                    <th>Footprint</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((svc, i) => (
                    <tr key={svc.tileId ? `tile:${svc.tileId}` : `service:${svc.id}`}>
                      <td className="service-table__reorder">
                        <button
                          className="settings-icon-btn"
                          aria-label={`Move ${svc.name} up`}
                          disabled={servicesWritePending || draftBlocked || i === 0}
                          onClick={() => handleServiceReorder(i, i - 1)}
                        >
                          ▲
                        </button>
                        <button
                          className="settings-icon-btn"
                          aria-label={`Move ${svc.name} down`}
                          disabled={
                            servicesWritePending ||
                            draftBlocked ||
                            i === services.length - 1
                          }
                          onClick={() => handleServiceReorder(i, i + 1)}
                        >
                          ▼
                        </button>
                      </td>
                      <td>{svc.name}</td>
                      <td className="service-table__url">{svc.url ?? "—"}</td>
                      <td>{svc.group ?? "—"}</td>
                      <td>
                        {effectiveFootprint(svc).columnSpan}×{effectiveFootprint(svc).rowSpan}
                      </td>
                      <td className="service-table__actions">
                        <button
                          className="settings-btn"
                          onClick={() => openEditForm(i)}
                          disabled={servicesWritePending || draftBlocked}
                        >
                          Edit
                        </button>
                        <button
                          className="settings-btn settings-btn--danger"
                          onClick={() => handleServiceDelete(i)}
                          disabled={servicesWritePending || draftBlocked}
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
              <button
                className="settings-save-btn"
                onClick={openAddForm}
                disabled={servicesWritePending || draftBlocked}
              >
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
          siblingIntegrationTypes={
            editingIndex === null ? [] : services
              .filter((candidate, index) => index !== editingIndex && candidate.id === services[editingIndex].id)
              .flatMap((candidate) => candidate.widget ? [widgetIntegrationRequirement(candidate.widget.type)] : [])
              .filter((type): type is string => type !== null)
          }
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
