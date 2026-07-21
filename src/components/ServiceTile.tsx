"use client";

import { useEffect, useState } from "react";
import type { Size } from "@/config/schema";
import { WidgetRenderer } from "./WidgetRenderer";

// Client-safe slice of ServiceWidget: the config (credentials) stays on the
// server — the widget data API looks it up in settings.yaml by service name.
export interface TileWidget {
  type: string;
  refresh_interval_ms?: number;
}

/**
 * Optional dnd-kit wiring for edit mode (B2). When present, the tile becomes a
 * sortable node: `ref`/`style` come from `useSortable`, and an additive
 * `.tile-drag-handle` child carries the drag listeners. Omitted in view mode,
 * so the tile renders byte-for-byte identically outside edit mode.
 */
export interface TileDragHandle {
  /** `setNodeRef` for the sortable/movable element (the tile root). */
  nodeRef?: (el: HTMLElement | null) => void;
  /** Transform/transition style from `useSortable`. */
  style?: React.CSSProperties;
  /** `setActivatorNodeRef` for the handle element. */
  handleRef?: (el: HTMLElement | null) => void;
  attributes?: Record<string, unknown>;
  listeners?: Record<string, unknown>;
  /** Accessible label for the handle. */
  label?: string;
  /** True while this tile is the active drag source (dims the placeholder). */
  dragging?: boolean;
}

/** The grip glyph shared by service and bookmark drag handles. */
export function DragGrip() {
  return (
    <svg
      className="tile-drag-handle__grip"
      aria-hidden="true"
      width="10"
      height="16"
      viewBox="0 0 10 16"
    >
      <circle cx="2.5" cy="3" r="1.3" fill="currentColor" />
      <circle cx="7.5" cy="3" r="1.3" fill="currentColor" />
      <circle cx="2.5" cy="8" r="1.3" fill="currentColor" />
      <circle cx="7.5" cy="8" r="1.3" fill="currentColor" />
      <circle cx="2.5" cy="13" r="1.3" fill="currentColor" />
      <circle cx="7.5" cy="13" r="1.3" fill="currentColor" />
    </svg>
  );
}

interface ServiceTileProps {
  name: string;
  url?: string;
  icon?: string;
  description?: string;
  widget?: TileWidget;
  /**
   * Tile size preset (see SIZE_SPANS in src/config/resolve.ts). The grid span
   * comes from the `service-tile--<size>` CSS modifier, not inline styles, so
   * the mobile media queries can collapse every preset to a full-width single
   * cell. All sizes show icon + name + description + status; the widget area
   * simply gets the extra room on wide/tall/large.
   */
  size?: Size;
  /**
   * Preview/edit rendering: suppress all background polling (status ping and
   * widget data). The tile still shows icon/name/description and a static
   * widget-type placeholder, so edit mode can render N tiles without N live
   * fetches. Absent (the default) keeps behavior byte-for-byte identical.
   */
  preview?: boolean;
  /** Edit-mode drag wiring (B2). Absent in view mode. */
  drag?: TileDragHandle;
  /**
   * Edit-mode per-tile menu (B3), rendered as an ADDITIVE child of the tile
   * (new `.tile-kebab` class) without touching the `.service-tile` root or its
   * class list. The tile root is often an `<a>`, so the kebab's own trigger
   * guards event propagation/navigation. Absent in view mode.
   */
  kebab?: React.ReactNode;
}

type PingStatus = "pending" | "ok" | "error";

function StatusDot({ url, preview }: { url: string; preview?: boolean }) {
  const [status, setStatus] = useState<PingStatus>("pending");

  useEffect(() => {
    if (preview) return; // no live probing while editing
    const check = async () => {
      try {
        const res = await fetch(
          `/api/ping?url=${encodeURIComponent(url)}`
        );
        const data = await res.json();
        setStatus(data.ok ? "ok" : "error");
      } catch {
        setStatus("error");
      }
    };

    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, [url, preview]);

  return (
    <div
      className={`status-dot status-dot--${status}`}
      title={status === "pending" ? "Checking…" : status === "ok" ? "Online" : "Offline"}
      aria-label={status === "pending" ? "Checking status" : status === "ok" ? "Online" : "Offline"}
    />
  );
}

function ServiceIcon({ icon, url, name }: { icon?: string; url?: string; name: string }) {
  const [iconError, setIconError] = useState(false);
  const [faviconError, setFaviconError] = useState(false);

  const faviconUrl = (() => {
    if (!url) return null;
    try {
      return new URL("/favicon.ico", url).href;
    } catch {
      return null;
    }
  })();

  if (icon && !iconError) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={icon}
        alt=""
        className="service-tile__icon"
        onError={() => setIconError(true)}
      />
    );
  }

  if (faviconUrl && !faviconError) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={faviconUrl}
        alt=""
        className="service-tile__icon"
        onError={() => setFaviconError(true)}
      />
    );
  }

  return (
    <div className="service-tile__letter-fallback" aria-hidden="true">
      {name[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

export default function ServiceTile({ name, url, icon, description, widget, size = "normal", preview = false, drag, kebab }: ServiceTileProps) {
  const className =
    `service-tile service-tile--${size}` +
    (drag ? " service-tile--editable" : "") +
    (drag?.dragging ? " service-tile--dragging" : "");

  const handle = drag ? (
    <span
      ref={drag.handleRef}
      className="tile-drag-handle"
      aria-label={drag.label ?? `Reorder ${name}`}
      {...drag.attributes}
      {...drag.listeners}
    >
      <DragGrip />
    </span>
  ) : null;

  const inner = (
    <>
      {handle}
      {kebab}
      {url && <StatusDot url={url} preview={preview} />}
      <ServiceIcon icon={icon} url={url} name={name} />
      <span className="service-tile__name">{name}</span>
      {description && (
        <span className="service-tile__description">{description}</span>
      )}
      {widget && (
        <div className="service-tile__widget" data-widget-type={widget.type}>
          {preview ? (
            <span className="service-tile__widget-preview" aria-hidden="true">
              {widget.type}
            </span>
          ) : (
            <WidgetRenderer
              type={widget.type}
              serviceName={name}
              refreshInterval={widget.refresh_interval_ms}
            />
          )}
        </div>
      )}
    </>
  );

  if (url) {
    return (
      <a
        ref={drag?.nodeRef}
        style={drag?.style}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        // In edit mode the tile is a drag surface, not a link: suppress
        // navigation so a click/drag never leaves the page and drops the draft.
        onClick={drag ? (e) => e.preventDefault() : undefined}
      >
        {inner}
      </a>
    );
  }

  return (
    <div ref={drag?.nodeRef} style={drag?.style} className={className}>
      {inner}
    </div>
  );
}
