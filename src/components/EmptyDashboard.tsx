"use client";

import GuardedLink from "./unsaved/GuardedLink";
import { useId } from "react";
import { useEditModeOptional } from "./edit/EditModeProvider";
import "./EmptyDashboard.css";

export default function EmptyDashboard({ hasSavedServices }: { hasSavedServices: boolean }) {
  const edit = useEditModeOptional();
  const headingId = useId();
  const loading = edit?.status === "loading";

  return (
    <section className="empty-dashboard" aria-labelledby={headingId} aria-busy={loading}>
      <h1 id={headingId}>Your dashboard is ready to make your own</h1>
      <p>Add service links, live widgets or bookmarks to keep your homelab close at hand.</p>
      {hasSavedServices && (
        <p>You have saved services, but no tiles placed on this dashboard. Manage them in Settings → Services.</p>
      )}
      <p>You can also configure services and layout in <code>settings.yaml</code>.</p>
      {edit?.canEdit ? (
        <div className="empty-dashboard__actions">
          <button
            type="button"
            className="settings-save-btn"
            disabled={loading}
            onClick={() => edit.requestTileAdd(hasSavedServices ? "picker" : "service")}
          >
            {loading ? "Opening editor…" : hasSavedServices ? "Add a tile" : "Add your first service"}
          </button>
          {!hasSavedServices && (
            <button type="button" className="settings-btn" disabled={loading} onClick={() => edit.requestTileAdd("picker")}>
              More tile options
            </button>
          )}
          {hasSavedServices && <GuardedLink href="/settings">Manage saved services</GuardedLink>}
        </div>
      ) : <p>Ask an administrator to add tiles, or update the configuration file.</p>}
      {edit?.status === "error" && edit.error && <p className="empty-dashboard__error" role="alert">{edit.error}</p>}
    </section>
  );
}
