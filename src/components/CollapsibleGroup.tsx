"use client";

import { useEffect, useState } from "react";

/**
 * localStorage key prefix for the per-device collapse state of a group.
 * Namespaced per group name; the stored value is "true" | "false".
 */
export const GROUP_COLLAPSE_STORAGE_PREFIX = "kokpit.group-collapsed:";

export interface CollapsibleGroupProps {
  /** Group display name — also namespaces the localStorage key. */
  name: string;
  /**
   * Default collapse state from YAML (`groups[].collapsed`). Only used when
   * no per-device preference is stored yet.
   */
  defaultCollapsed?: boolean;
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
      className={`service-group${collapsed ? " service-group--collapsed" : ""}`}
    >
      <h2 className="service-group__header">
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
      </h2>
      <div className="service-group__body">
        <div className="service-group__body-inner">{children}</div>
      </div>
    </section>
  );
}
