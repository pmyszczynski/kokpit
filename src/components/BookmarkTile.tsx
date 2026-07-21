"use client";

// Client component (not a server component): the per-link icon fallback
// chain — explicit icon → site favicon → 2-char abbr → first letter — needs
// onError state, exactly like ServiceTile's icon handling. All props are
// plain serializable data; nothing sensitive crosses the boundary.
import { useState } from "react";
import type { BookmarkLink, Size } from "@/config/schema";
import { DragGrip, type TileDragHandle } from "./ServiceTile";

export type BookmarkTileVariant = "list" | "icon-grid" | "compact";

export interface BookmarkTileProps {
  /** Bookmark group name, shown in the tile header. */
  name: string;
  /** Optional CSS color tinting the header underline and link markers. */
  accent?: string;
  /**
   * Internal layout:
   * - `list`: icon + name rows with an accent marker; optional per-link
   *   `description` as a muted second line (list style only).
   * - `icon-grid`: grid of icons, name only as tooltip/aria-label.
   * - `compact`: text-only two-column list, no icons.
   */
  variant: BookmarkTileVariant;
  /** Tile size preset — same presets as service tiles (SIZE_SPANS). */
  size: Size;
  links: BookmarkLink[];
  /** Edit-mode drag wiring (B2). Absent in view mode. */
  drag?: TileDragHandle;
  /**
   * Edit-mode per-tile menu (B3): an additive `.tile-kebab` child that does not
   * alter the `.bookmark-tile` root or its class list. Absent in view mode.
   */
  kebab?: React.ReactNode;
}

function BookmarkIcon({
  icon,
  url,
  abbr,
  name,
}: Pick<BookmarkLink, "icon" | "url" | "abbr" | "name">) {
  const [iconError, setIconError] = useState(false);
  const [faviconError, setFaviconError] = useState(false);

  // Same favicon strategy as ServiceTile: /favicon.ico on the link's origin.
  const faviconUrl = (() => {
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
        className="bookmark-tile__icon"
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
        className="bookmark-tile__icon"
        onError={() => setFaviconError(true)}
      />
    );
  }

  const fallback =
    abbr && abbr.trim() !== ""
      ? abbr.trim().slice(0, 2)
      : name[0]?.toUpperCase() ?? "?";
  return (
    <span className="bookmark-tile__abbr" aria-hidden="true">
      {fallback}
    </span>
  );
}

export default function BookmarkTile({
  name,
  accent,
  variant,
  size,
  links,
  drag,
  kebab,
}: BookmarkTileProps) {
  const style: React.CSSProperties | undefined =
    accent || drag?.style
      ? {
          ...(accent
            ? ({ "--bookmark-accent": accent } as React.CSSProperties)
            : {}),
          ...(drag?.style ?? {}),
        }
      : undefined;

  const className =
    `bookmark-tile bookmark-tile--${variant} bookmark-tile--${size}` +
    (drag ? " bookmark-tile--editable" : "") +
    (drag?.dragging ? " bookmark-tile--dragging" : "");

  return (
    <div ref={drag?.nodeRef} className={className} style={style}>
      {drag && (
        <span
          ref={drag.handleRef}
          className="tile-drag-handle"
          aria-label={drag.label ?? `Reorder ${name}`}
          {...drag.attributes}
          {...drag.listeners}
        >
          <DragGrip />
        </span>
      )}
      {kebab}
      <h3 className="bookmark-tile__header">{name}</h3>
      <div className="bookmark-tile__links">
        {links.map((link) =>
          variant === "icon-grid" ? (
            <a
              key={`${link.name} ${link.url}`}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="bookmark-tile__link"
              title={link.name}
              aria-label={link.name}
            >
              <BookmarkIcon
                icon={link.icon}
                url={link.url}
                abbr={link.abbr}
                name={link.name}
              />
            </a>
          ) : variant === "compact" ? (
            <a
              key={`${link.name} ${link.url}`}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="bookmark-tile__link"
            >
              <span className="bookmark-tile__link-name">{link.name}</span>
            </a>
          ) : (
            <a
              key={`${link.name} ${link.url}`}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="bookmark-tile__link"
            >
              <span className="bookmark-tile__marker" aria-hidden="true" />
              <BookmarkIcon
                icon={link.icon}
                url={link.url}
                abbr={link.abbr}
                name={link.name}
              />
              <span className="bookmark-tile__link-body">
                <span className="bookmark-tile__link-name">{link.name}</span>
                {link.description && (
                  <span className="bookmark-tile__link-description">
                    {link.description}
                  </span>
                )}
              </span>
            </a>
          )
        )}
      </div>
    </div>
  );
}
