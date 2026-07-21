// Pure group-management logic shared by the settings panel (Phase A) and the
// dashboard edit-mode group kebab (Work Package B3).
//
// A group rename/delete does not just touch the `groups:` array — it must
// cascade into every `service.group` and `bookmark.placement.group` that
// references the group, atomically. `applyGroupCascades` is the exact logic
// Phase A shipped in SettingsPanel (extracted verbatim so both call sites stay
// in sync); the `*Patch`/`*Group` helpers build on it to produce the minimal
// draft patch each edit-mode action stages via `updateDraft`.
import {
  serviceNameUniquenessKey,
  type BookmarkGroup,
  type Group,
  type KokpitConfig,
  type Service,
} from "./schema";

/** A staged group edit whose effect on services/bookmarks is applied on save. */
export type GroupCascadeOp =
  | { type: "rename"; from: string; to: string }
  | { type: "delete"; name: string };

/**
 * Applies staged group ops (in order) to the current services and bookmarks,
 * producing cascaded copies. A rename rewrites every matching `service.group`
 * and `bookmark.placement.group`; a delete clears those references (dropping an
 * emptied placement). Pure — the moved objects are otherwise preserved intact.
 */
export function applyGroupCascades(
  services: Service[],
  bookmarks: BookmarkGroup[],
  ops: GroupCascadeOp[]
): {
  services: Service[];
  bookmarks: BookmarkGroup[];
  servicesChanged: boolean;
  bookmarksChanged: boolean;
} {
  let svc = services;
  let bm = bookmarks;
  let servicesChanged = false;
  let bookmarksChanged = false;

  for (const op of ops) {
    const key = serviceNameUniquenessKey(
      op.type === "rename" ? op.from : op.name
    );

    svc = svc.map((s) => {
      if (!s.group || serviceNameUniquenessKey(s.group) !== key) return s;
      servicesChanged = true;
      if (op.type === "rename") return { ...s, group: op.to };
      const { group: _group, ...rest } = s;
      return rest;
    });

    bm = bm.map((b) => {
      if (
        !b.placement?.group ||
        serviceNameUniquenessKey(b.placement.group) !== key
      )
        return b;
      bookmarksChanged = true;
      if (op.type === "rename") {
        return { ...b, placement: { ...b.placement, group: op.to } };
      }
      const { group: _group, ...restPlacement } = b.placement;
      const placement =
        Object.keys(restPlacement).length > 0 ? restPlacement : undefined;
      return { ...b, placement };
    });
  }

  return { services: svc, bookmarks: bm, servicesChanged, bookmarksChanged };
}

/** Editable draft slice the group ops read/write. */
type GroupDraft = Pick<KokpitConfig, "services"> & {
  groups: Group[];
  bookmarks: BookmarkGroup[];
};

/** A minimal patch of only the top-level keys an op actually changes. */
export type GroupEditPatch = Partial<
  Pick<KokpitConfig, "groups" | "services" | "bookmarks">
>;

/**
 * Rename a group and cascade the reference rewrite into services + bookmark
 * placements. Returns a patch containing only the keys that changed, so a
 * rename of an undeclared group (no `groups:` entry) never marks `groups`
 * dirty. Duplicate-name guarding is the caller's job (see EditableServiceGrid).
 */
export function renameGroupPatch(
  draft: GroupDraft,
  oldName: string,
  newName: string
): GroupEditPatch {
  const oldKey = serviceNameUniquenessKey(oldName);
  const patch: GroupEditPatch = {};

  const groupsChanged = draft.groups.some(
    (g) => serviceNameUniquenessKey(g.name) === oldKey
  );
  if (groupsChanged) {
    patch.groups = draft.groups.map((g) =>
      serviceNameUniquenessKey(g.name) === oldKey ? { ...g, name: newName } : g
    );
  }

  const cascade = applyGroupCascades(draft.services, draft.bookmarks, [
    { type: "rename", from: oldName, to: newName },
  ]);
  if (cascade.servicesChanged) patch.services = cascade.services;
  if (cascade.bookmarksChanged) patch.bookmarks = cascade.bookmarks;
  return patch;
}

/**
 * Delete a group: drop its `groups:` entry, orphan its member services (clear
 * `group`) and clear referencing bookmark placements — the same semantics as
 * Phase A's Groups-tab delete. Returns a minimal patch.
 */
export function deleteGroupPatch(draft: GroupDraft, name: string): GroupEditPatch {
  const nameKey = serviceNameUniquenessKey(name);
  const patch: GroupEditPatch = {};

  const nextGroups = draft.groups.filter(
    (g) => serviceNameUniquenessKey(g.name) !== nameKey
  );
  if (nextGroups.length !== draft.groups.length) patch.groups = nextGroups;

  const cascade = applyGroupCascades(draft.services, draft.bookmarks, [
    { type: "delete", name },
  ]);
  if (cascade.servicesChanged) patch.services = cascade.services;
  if (cascade.bookmarksChanged) patch.bookmarks = cascade.bookmarks;
  return patch;
}

/**
 * Declare an auto-appended (undeclared) group by appending it to `groups:`, so
 * it becomes orderable/manageable. No-op (returns the same array) if a group
 * with that name (case-insensitive) is already declared.
 */
export function declareGroup(groups: Group[], name: string): Group[] {
  const key = serviceNameUniquenessKey(name);
  if (key === "" || groups.some((g) => serviceNameUniquenessKey(g.name) === key))
    return groups;
  return [...groups, { name }];
}

/**
 * Set (or clear, when `columns` is undefined) the per-group column override.
 * Clamped to the Phase A range [1, 12]. Returns a new `groups:` array.
 */
export function setGroupColumns(
  groups: Group[],
  name: string,
  columns: number | undefined
): Group[] {
  const key = serviceNameUniquenessKey(name);
  const clamped =
    columns == null || isNaN(columns) || columns < 1
      ? undefined
      : Math.min(Math.floor(columns), 12);
  return groups.map((g) => {
    if (serviceNameUniquenessKey(g.name) !== key) return g;
    if (clamped === undefined) {
      const { columns: _columns, ...rest } = g;
      return rest;
    }
    return { ...g, columns: clamped };
  });
}
