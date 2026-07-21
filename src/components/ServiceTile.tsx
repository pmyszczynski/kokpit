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

export default function ServiceTile({ name, url, icon, description, widget, size = "normal", preview = false }: ServiceTileProps) {
  const className = `service-tile service-tile--${size}`;

  const inner = (
    <>
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
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {inner}
      </a>
    );
  }

  return <div className={className}>{inner}</div>;
}
