"use client";

import { useEffect, useState } from "react";

/**
 * localStorage key prefix for the per-device collapse state of a group.
 * Namespaced per group name; the stored value is "true" | "false".
 */
export const GROUP_COLLAPSE_STORAGE_PREFIX = "kokpit.group-collapsed:";

/**
 * Move a group's per-device collapse preference from `oldName` to `newName`
 * when a group is renamed in edit mode, so the state isn't orphaned under the
 * old key. No-op when nothing is stored, when the names are equal, or when
 * localStorage is unavailable.
 */
export function migrateGroupCollapseKey(oldName: string, newName: string): void {
  if (oldName === newName) return;
  try {
    const stored = window.localStorage.getItem(
      GROUP_COLLAPSE_STORAGE_PREFIX + oldName
    );
    if (stored === null) return;
    window.localStorage.setItem(
      GROUP_COLLAPSE_STORAGE_PREFIX + newName,
      stored
    );
    window.localStorage.removeItem(GROUP_COLLAPSE_STORAGE_PREFIX + oldName);
  } catch {
    // Storage unavailable (private mode, etc.) — nothing to migrate.
  }
}

/**
 * Edit-mode group-reorder wiring (B2). When present the whole section becomes a
 * sortable node and the header grows a `.group-drag-handle` — rendered as a
 * SIBLING of the collapse toggle button (never nested inside it, which would be
 * invalid HTML). Omitted in view mode, so the header is unchanged there.
 */
export interface GroupDragHandle {
  nodeRef?: (el: HTMLElement | null) => void;
  style?: React.CSSProperties;
  handleRef?: (el: HTMLElement | null) => void;
  attributes?: Record<string, unknown>;
  listeners?: Record<string, unknown>;
  dragging?: boolean;
}

export interface CollapsibleGroupProps {
  /** Group display name — also namespaces the localStorage key. */
  name: string;
  /**
   * Default collapse state from YAML (`groups[].collapsed`). Only used when
   * no per-device preference is stored yet.
   */
  defaultCollapsed?: boolean;
  /** Edit-mode drag-reorder wiring for declared groups. Absent in view mode. */
  drag?: GroupDragHandle;
  /**
   * Edit-mode management controls (the group kebab), rendered as a SIBLING of
   * the collapse toggle inside the `<h2>` header — never nested in the toggle
   * button. Absent in view mode, so the header markup is unchanged there.
   */
  headerActions?: React.ReactNode;
  /** Server-rendered tile grid; stays an RSC subtree passed through as children. */
  children: React.ReactNode;
}

/**
 * Collapsible dashboard group section. The tiles themselves stay
 * server-rendered — this client component only owns the header chevron and
 * the collapse state.
 *
 * Collapse state is a per-device preference (localStorage); the YAML
 * `collapsed` flag only sets the default when nothing is stored.
 *
 * Hydration tradeoff: the first paint always uses the YAML default and
 * localStorage is read in an effect, so server and client markup match (no
 * hydration mismatch). A group whose stored state differs from the YAML
 * default therefore snaps open/closed one frame after hydration — accepted
 * for Phase A over blocking inline scripts or a cookie round-trip.
 */
export default function CollapsibleGroup({
  name,
  defaultCollapsed = false,
  drag,
  headerActions,
  children,
}: CollapsibleGroupProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(
        GROUP_COLLAPSE_STORAGE_PREFIX + name
      );
      if (stored === "true") setCollapsed(true);
      else if (stored === "false") setCollapsed(false);
    } catch {
      // Storage unavailable (private mode, etc.) — keep the YAML default.
    }
  }, [name]);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(
          GROUP_COLLAPSE_STORAGE_PREFIX + name,
          String(next)
        );
      } catch {
        // Best effort — the in-memory state still toggles.
      }
      return next;
    });
  };

  return (
    <section
      ref={drag?.nodeRef}
      style={drag?.style}
      className={
        `service-group${collapsed ? " service-group--collapsed" : ""}` +
        (drag ? " service-group--editable" : "") +
        (drag?.dragging ? " service-group--dragging" : "")
      }
    >
      <h2 className="service-group__header">
        {drag && (
          <span
            ref={drag.handleRef}
            className="group-drag-handle"
            aria-label={`Reorder group ${name}`}
            {...drag.attributes}
            {...drag.listeners}
          >
            <svg
              className="group-drag-handle__grip"
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
          </span>
        )}
        <button
          type="button"
          className="service-group__toggle"
          aria-expanded={!collapsed}
          onClick={toggle}
        >
          <svg
            className="service-group__chevron"
            aria-hidden="true"
            width="10"
            height="6"
            viewBox="0 0 10 6"
          >
            <path
              d="M1 1l4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{name}</span>
        </button>
        {headerActions}
      </h2>
      <div className="service-group__body">
        <div className="service-group__body-inner">{children}</div>
      </div>
    </section>
  );
}
