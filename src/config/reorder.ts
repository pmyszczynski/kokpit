// Pure array-manipulation logic for edit-mode drag-and-drop (Work Package B2).
//
// These functions are the source of truth for how a drag gesture mutates the
// staged draft. They take the current arrays and return NEW arrays with the
// affected item moved/reassigned — every other object is preserved intact
// (identity by name; widget config, bookmark links/accent/style untouched).
// The dnd-kit component computes a target group + target index from the drop
// and delegates here, so the reorder logic stays headless and unit-testable
// (jsdom cannot fire a real drag).
import {
  serviceNameUniquenessKey,
  type BookmarkGroup,
  type Group,
  type Service,
} from "./schema";

// ---- Tile / container id helpers (shared with EditableServiceGrid) ----

/** dnd-kit sortable id for a service tile. */
export const SERVICE_TILE_PREFIX = "service:";
/** dnd-kit sortable id for a bookmark-group tile. */
export const BOOKMARK_TILE_PREFIX = "bookmark:";
/** dnd-kit sortable id for a declared group's reorder handle. */
export const GROUP_SORTABLE_PREFIX = "groupsort:";
/** dnd-kit droppable id prefix for a named group's tile container. */
export const GROUP_CONTAINER_PREFIX = "container:";
/** Droppable id for the implicit ungrouped-services section (group = none). */
export const UNGROUPED_CONTAINER_ID = "__ungrouped__";
/** Droppable id for the implicit Bookmarks section (placement.group = none). */
export const BOOKMARKS_CONTAINER_ID = "__bookmarks__";

export function serviceTileId(name: string): string {
  return SERVICE_TILE_PREFIX + name;
}
export function bookmarkTileId(name: string): string {
  return BOOKMARK_TILE_PREFIX + name;
}
export function groupSortableId(name: string): string {
  return GROUP_SORTABLE_PREFIX + serviceNameUniquenessKey(name);
}
export function groupContainerId(name: string): string {
  return GROUP_CONTAINER_PREFIX + serviceNameUniquenessKey(name);
}

/** Normalized group key; `null`/empty → "" (the "no group" bucket). */
function normalizeGroup(group: string | null | undefined): string {
  if (group == null) return "";
  return serviceNameUniquenessKey(group);
}

function indexByName<T extends { name: string }>(
  items: T[],
  name: string
): number {
  const key = serviceNameUniquenessKey(name);
  return items.findIndex((item) => serviceNameUniquenessKey(item.name) === key);
}

/**
 * Insertion index into `rest` (the array with the moving item already removed)
 * that lands the moving item at `targetIndex` among the target group's members.
 * An empty target group has no member slots, so array position is
 * display-irrelevant (grouping is bucketed, not array-positional) — append.
 */
function insertionIndex(memberPositions: number[], targetIndex: number, restLength: number): number {
  const clamped = Math.max(0, Math.min(targetIndex, memberPositions.length));
  if (memberPositions.length === 0) return restLength;
  if (clamped >= memberPositions.length) {
    return memberPositions[memberPositions.length - 1] + 1;
  }
  return memberPositions[clamped];
}

/** Return `service` with its `group` set to `targetGroup` (or cleared). */
function withServiceGroup(service: Service, targetGroup: string | null): Service {
  if (targetGroup == null || targetGroup.trim() === "") {
    const clone: Service = { ...service };
    delete clone.group;
    return clone;
  }
  return { ...service, group: targetGroup };
}

/**
 * Move a service tile to `targetGroup` at `targetIndex` (0-based position among
 * that group's members, computed WITHOUT the moving item — the caller derives
 * it from the drop, e.g. via arrayMove for a same-group reorder).
 *
 * - `targetGroup === null` (or blank) clears `group` → the ungrouped section.
 * - Same group ⇒ pure within-group reorder.
 * - The moved service object is preserved intact apart from its `group` field;
 *   every other service keeps its position and identity.
 */
export function moveServiceToGroup(
  services: Service[],
  serviceName: string,
  targetGroup: string | null,
  targetIndex: number
): Service[] {
  const index = indexByName(services, serviceName);
  if (index === -1) return services;

  const moving = withServiceGroup(services[index], targetGroup);
  const rest = services.filter((_, i) => i !== index);

  const targetKey = normalizeGroup(targetGroup);
  const memberPositions: number[] = [];
  rest.forEach((s, i) => {
    if (normalizeGroup(s.group) === targetKey) memberPositions.push(i);
  });

  const next = [...rest];
  next.splice(insertionIndex(memberPositions, targetIndex, rest.length), 0, moving);
  return next;
}

/** Return `bookmark` with `placement.group` set to `targetGroup` (or cleared). */
function withBookmarkGroup(
  bookmark: BookmarkGroup,
  targetGroup: string | null
): BookmarkGroup {
  if (targetGroup == null || targetGroup.trim() === "") {
    if (!bookmark.placement) return { ...bookmark };
    // Preserve placement.size (and any other keys); only drop `group`.
    const rest = { ...bookmark.placement };
    delete rest.group;
    const clone: BookmarkGroup = { ...bookmark };
    if (Object.keys(rest).length === 0) delete clone.placement;
    else clone.placement = rest;
    return clone;
  }
  return {
    ...bookmark,
    placement: { ...(bookmark.placement ?? {}), group: targetGroup },
  };
}

/**
 * Move a bookmark-group tile to `targetGroup` at `targetIndex`. Mirrors
 * {@link moveServiceToGroup} but updates `placement.group`:
 * - `targetGroup === null` clears `placement.group` (and drops an emptied
 *   `placement`) so the tile falls to the implicit Bookmarks section —
 *   matching ServiceGrid semantics.
 * - `placement.size`, links, accent and style are preserved intact.
 */
export function moveBookmarkToGroup(
  bookmarks: BookmarkGroup[],
  bookmarkName: string,
  targetGroup: string | null,
  targetIndex: number
): BookmarkGroup[] {
  const index = indexByName(bookmarks, bookmarkName);
  if (index === -1) return bookmarks;

  const moving = withBookmarkGroup(bookmarks[index], targetGroup);
  const rest = bookmarks.filter((_, i) => i !== index);

  const targetKey = normalizeGroup(targetGroup);
  const memberPositions: number[] = [];
  rest.forEach((b, i) => {
    if (normalizeGroup(b.placement?.group) === targetKey) memberPositions.push(i);
  });

  const next = [...rest];
  next.splice(insertionIndex(memberPositions, targetIndex, rest.length), 0, moving);
  return next;
}

/**
 * Reorder the declared `groups:` array by moving the group named `activeName`
 * to the array slot currently held by `overName` (arrayMove semantics). Only
 * declared groups participate; undeclared/auto-appended groups and the
 * implicit ungrouped/Bookmarks sections are pinned and never passed here.
 * A no-op (unknown name, or active === over) returns the original array.
 */
export function reorderGroups(
  groups: Group[],
  activeName: string,
  overName: string
): Group[] {
  const from = indexByName(groups, activeName);
  const to = indexByName(groups, overName);
  if (from === -1 || to === -1 || from === to) return groups;
  const next = [...groups];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
