"use client";

// Reusable edit-mode kebab menu (Work Package B3). The trigger is a
// `<span role="button">` (not a `<button>`) so it can live inside an anchor
// tile without invalid interactive-content nesting, and it stops pointer/click
// propagation so it never starts a drag or follows the tile's link. The menu
// body is rendered through a portal to `document.body`, positioned under the
// trigger — this keeps the menu items out of the anchor entirely and avoids
// being clipped by the tile's overflow.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface KebabProps {
  /** Accessible label for the trigger, e.g. `"Plex options"`. */
  label: string;
  /** Extra class on the trigger (e.g. `"tile-kebab"` or `"group-kebab"`). */
  triggerClassName?: string;
  /** Menu body; receives a `close` callback to dismiss after an action. */
  children: (close: () => void) => React.ReactNode;
}

export default function Kebab({ label, triggerClassName, children }: KebabProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(
    null
  );
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close and, when focus is currently inside the (about-to-be-removed) portal
  // menu, return it to the trigger so it's never orphaned on the detached node.
  // Used by item-selection and the outside-click handler; Escape restores
  // unconditionally below.
  const close = useCallback(() => {
    const menuHadFocus = menuRef.current?.contains(document.activeElement);
    setOpen(false);
    if (menuHadFocus) triggerRef.current?.focus();
  }, []);

  const guard = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    // Suppress anchor navigation when the tile root is an <a>.
    if ("preventDefault" in e) e.preventDefault();
  };

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    function update() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCoords({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    update();
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [open]);

  // Move focus into the menu once it's rendered (coords set), so keyboard users
  // land on the first interactive control (the rename field for a group kebab,
  // "Edit" for a tile kebab) instead of being stranded on the trigger.
  useEffect(() => {
    if (!open || !coords) return;
    const first = menuRef.current?.querySelector<HTMLElement>(
      '[role="menuitem"], input, button, select, textarea, a[href]'
    );
    first?.focus();
  }, [open, coords]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        menuRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  return (
    <span
      ref={triggerRef}
      role="button"
      tabIndex={0}
      className={`tile-kebab${triggerClassName ? ` ${triggerClassName}` : ""}`}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        guard(e);
        setOpen((v) => !v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }
      }}
    >
      <svg
        className="tile-kebab__glyph"
        aria-hidden="true"
        width="4"
        height="16"
        viewBox="0 0 4 16"
      >
        <circle cx="2" cy="2" r="1.6" fill="currentColor" />
        <circle cx="2" cy="8" r="1.6" fill="currentColor" />
        <circle cx="2" cy="14" r="1.6" fill="currentColor" />
      </svg>
      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="kebab-menu"
            style={{ top: coords.top, right: coords.right }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {children(close)}
          </div>,
          document.body
        )}
    </span>
  );
}
