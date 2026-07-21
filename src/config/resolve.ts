// Pure resolution helpers for the dashboard layout: effective tile sizes and
// group display order. No I/O, no widget imports — unit-testable and safe to
// call from both server and client code.
import type { KokpitConfig, Service, Size } from "./schema";
import { serviceNameUniquenessKey } from "./schema";

/** Effective size when nothing (explicit, legacy position, widget hint) applies. */
export const DEFAULT_SIZE: Size = "normal";

/** Effective bookmark-group style when `style` is omitted in YAML. */
export const DEFAULT_BOOKMARK_STYLE = "list" as const;

/** Col×row span of each size preset in the dashboard grid. */
export const SIZE_SPANS: Record<Size, { columns: number; rows: number }> = {
  normal: { columns: 1, rows: 1 },
  wide: { columns: 2, rows: 1 },
  tall: { columns: 1, rows: 2 },
  large: { columns: 2, rows: 2 },
};

/**
 * Whether `size` spans at least as much as `min` in both axes.
 * Used by the size picker to grey out sizes below a widget's `minSize`.
 */
export function sizeSatisfies(size: Size, min: Size): boolean {
  return (
    SIZE_SPANS[size].columns >= SIZE_SPANS[min].columns &&
    SIZE_SPANS[size].rows >= SIZE_SPANS[min].rows
  );
}

/**
 * Effective size of a service tile. Precedence:
 * 1. explicit `service.size`
 * 2. legacy `service.position` spans, mapped to the nearest preset
 *    (width ≥ 2 && height ≥ 2 → large; width ≥ 2 → wide; height ≥ 2 → tall;
 *    else normal)
 * 3. the widget's `preferredSize` hint (caller looks it up via
 *    `getWidgetSizeHints` from `@/widgets`)
 * 4. `normal`
 *
 * The result is then clamped up to `widgetMinSize` when declared: a
 * hand-edited config with an explicit `size` below the widget's floor still
 * renders at (at least) the floor, matching the size picker's greyed-out
 * options. When no `widgetMinSize` is given, behavior is unchanged.
 */
export function resolveServiceSize(
  service: Pick<Service, "size" | "position">,
  widgetPreferredSize?: Size,
  widgetMinSize?: Size
): Size {
  const base = ((): Size => {
    if (service.size) return service.size;
    if (service.position) {
      const wide = service.position.width >= 2;
      const tall = service.position.height >= 2;
      if (wide && tall) return "large";
      if (wide) return "wide";
      if (tall) return "tall";
      return DEFAULT_SIZE;
    }
    return widgetPreferredSize ?? DEFAULT_SIZE;
  })();

  if (widgetMinSize && !sizeSatisfies(base, widgetMinSize)) {
    return widgetMinSize;
  }
  return base;
}

/**
 * Migrate deprecated `position` to an explicit `size` for a services array,
 * ready to PATCH. For each service that has a legacy `position` but no explicit
 * `size`, set `size` to its position-derived preset (the position branch of
 * resolveServiceSize is independent of widget hints, so no registry lookup is
 * needed) and drop `position`. Services with an explicit `size` keep it (and
 * shed the now-redundant `position`); services without `position` are returned
 * untouched.
 *
 * Without this, PATCH's schema silently strips `position`, so saving any
 * unrelated edit in a legacy config would rewrite those services without their
 * position-derived size — a visual regression on the next render.
 */
export function migrateLegacyServiceSizes(services: Service[]): Service[] {
  return services.map((service) => {
    if (!service.position) return service;
    const { position: _position, ...rest } = service;
    if (service.size) return rest;
    return { ...rest, size: resolveServiceSize(service) };
  });
}

/** One entry in the resolved display order of dashboard sections. */
export interface ResolvedGroup {
  /** Group name (declared spelling wins); `null` for the implicit ungrouped section. */
  name: string | null;
  /** True when the group appears in the top-level `groups:` array. */
  declared: boolean;
  /** Default collapsed state (live state is a per-browser preference). */
  collapsed: boolean;
  /** Per-group column override, when declared. */
  columns?: number;
}

/**
 * Resolved display order of dashboard sections:
 * 1. declared `groups:` entries, in array order;
 * 2. groups referenced by `services[].group` or `bookmarks[].placement.group`
 *    but not declared, auto-appended in alphabetical order (first-seen
 *    spelling wins; matching against declared names is case-insensitive);
 * 3. the implicit ungrouped section (`name: null`), present only when at
 *    least one service has no group, placed per `layout.ungrouped`
 *    (default `last`).
 *
 * Bookmarks without a `placement.group` are not part of this ordering — their
 * default placement is a renderer concern.
 */
export function resolveGroupOrder(
  config: Pick<KokpitConfig, "layout" | "services"> &
    Partial<Pick<KokpitConfig, "groups" | "bookmarks">>
): ResolvedGroup[] {
  const ordered: ResolvedGroup[] = [];
  const seen = new Set<string>();

  for (const group of config.groups ?? []) {
    const key = serviceNameUniquenessKey(group.name);
    if (key === "" || seen.has(key)) continue; // schema rejects these; be defensive
    seen.add(key);
    ordered.push({
      name: group.name,
      declared: true,
      collapsed: group.collapsed ?? false,
      columns: group.columns,
    });
  }

  // Groups referenced but not declared → auto-append alphabetically.
  const referenced = new Map<string, string>(); // key → first-seen spelling
  let hasUngrouped = false;
  for (const service of config.services) {
    const name = service.group?.trim() ?? "";
    if (name === "") {
      hasUngrouped = true;
    } else {
      const key = serviceNameUniquenessKey(name);
      if (!seen.has(key) && !referenced.has(key)) referenced.set(key, name);
    }
  }
  for (const bookmark of config.bookmarks ?? []) {
    const name = bookmark.placement?.group?.trim() ?? "";
    if (name === "") continue;
    const key = serviceNameUniquenessKey(name);
    if (!seen.has(key) && !referenced.has(key)) referenced.set(key, name);
  }
  const appended = Array.from(referenced.values()).sort((a, b) =>
    a.localeCompare(b)
  );
  for (const name of appended) {
    ordered.push({ name, declared: false, collapsed: false });
  }

  if (hasUngrouped) {
    const section: ResolvedGroup = {
      name: null,
      declared: false,
      collapsed: false,
    };
    if ((config.layout.ungrouped ?? "last") === "first") {
      ordered.unshift(section);
    } else {
      ordered.push(section);
    }
  }

  return ordered;
}
