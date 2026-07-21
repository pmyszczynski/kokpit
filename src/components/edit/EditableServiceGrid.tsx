"use client";

// Edit-mode dashboard render (Work Package B2): the B1 static mirror of
// ServiceGrid made drag-reorderable with dnd-kit. All mutations flow through
// the B1 setters (setServices/setBookmarks/setGroups) so dirty tracking + save
// keep working; the pure array logic lives in @/config/reorder and is unit
// tested there. View mode (ServiceGrid) is untouched — this is additive.
//
// DnD model (kept deliberately simple + predictable):
//  - Tiles: one SortableContext per section; each section grid is a droppable
//    container. Dragging a tile reorders within its section, or moves it into
//    another section (reassigning service.group / bookmark.placement.group).
//    Dropping in the ungrouped services grid or the implicit Bookmarks section
//    clears the group (null container).
//  - Groups: only DECLARED groups (config.groups) get a header drag handle and
//    reorder among themselves via the groups array. Undeclared/auto-appended
//    groups and the pinned ungrouped/Bookmarks sections are NOT draggable and
//    stay where resolveGroupOrder + layout.ungrouped place them.
//  - Sensors: PointerSensor with an 8px activation distance (taps/scrolls on
//    touch never start a drag) + KeyboardSensor (full keyboard DnD for free).
import "@/integrations";
import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DEFAULT_BOOKMARK_STYLE,
  resolveGroupOrder,
  resolveServiceSize,
} from "@/config/resolve";
import {
  BOOKMARKS_CONTAINER_ID,
  UNGROUPED_CONTAINER_ID,
  bookmarkTileId,
  groupContainerId,
  groupSortableId,
  moveBookmarkToGroup,
  moveServiceToGroup,
  reorderGroups,
  serviceTileId,
} from "@/config/reorder";
import {
  serviceNameUniquenessKey,
  type BookmarkGroup,
  type KokpitConfig,
  type Service,
  type ServiceWidget,
  type Size,
} from "@/config/schema";
import {
  declareGroup,
  deleteGroupPatch,
  renameGroupPatch,
  setGroupColumns,
} from "@/config/groupCascade";
import { duplicateBookmark, duplicateService } from "@/config/duplicate";
import { useEditMode } from "./EditModeProvider";
import { getWidget, getWidgetSizeHints } from "@/widgets";
import BookmarkTile from "../BookmarkTile";
import CollapsibleGroup, { migrateGroupCollapseKey } from "../CollapsibleGroup";
import ServiceTile, { type TileWidget } from "../ServiceTile";
import ServiceForm from "../ServiceForm";
import BookmarkGroupForm from "../BookmarkGroupForm";
import AddTilePicker, { type AddChoice } from "./AddTilePicker";
import { BookmarkTileMenu, GroupKebab, ServiceTileMenu } from "./tileMenus";

// Mirrors ServiceGrid.resolveTileWidget: unknown types pass through so the typo
// still surfaces; known-but-invalid config downgrades to a plain link.
function resolveTileWidget(widget?: ServiceWidget): TileWidget | undefined {
  if (!widget) return undefined;
  const def = getWidget(widget.type);
  if (def && !def.configSchema.safeParse(widget.config ?? {}).success) {
    return undefined;
  }
  return { type: widget.type, refresh_interval_ms: widget.refresh_interval_ms };
}

function resolveBookmarkSize(bookmark: BookmarkGroup): Size {
  if (bookmark.placement?.size) return bookmark.placement.size;
  const style = bookmark.style ?? DEFAULT_BOOKMARK_STYLE;
  return style === "list" ? "tall" : "normal";
}

function serviceTileProps(service: Service) {
  const hints = service.widget
    ? getWidgetSizeHints(service.widget.type)
    : undefined;
  return {
    name: service.name,
    url: service.url,
    icon: service.icon,
    description: service.description,
    widget: resolveTileWidget(service.widget),
    size: resolveServiceSize(service, hints?.preferredSize, hints?.minSize),
  };
}

// ---- dnd data payloads carried on each draggable/droppable ----

interface TileData {
  type: "tile";
  kind: "service" | "bookmark";
  name: string;
  containerId: string;
}
interface ContainerData {
  type: "container";
  containerId: string;
}
interface GroupData {
  type: "group";
  name: string;
}

interface ContainerInfo {
  id: string;
  /** Display group name to assign on drop; null = clear group. */
  group: string | null;
  serviceNames: string[];
  bookmarkNames: string[];
}

// ---- sortable/droppable subcomponents ----

function SortableServiceTile({
  service,
  containerId,
  kebab,
}: {
  service: Service;
  containerId: string;
  kebab?: React.ReactNode;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: serviceTileId(service.name),
    data: {
      type: "tile",
      kind: "service",
      name: service.name,
      containerId,
    } satisfies TileData,
  });
  return (
    <ServiceTile
      {...serviceTileProps(service)}
      preview
      kebab={kebab}
      drag={{
        nodeRef: setNodeRef,
        handleRef: setActivatorNodeRef,
        style: { transform: CSS.Translate.toString(transform), transition },
        attributes: attributes as unknown as Record<string, unknown>,
        listeners,
        dragging: isDragging,
        label: `Reorder ${service.name}`,
      }}
    />
  );
}

function SortableBookmarkTile({
  bookmark,
  containerId,
  kebab,
}: {
  bookmark: BookmarkGroup;
  containerId: string;
  kebab?: React.ReactNode;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: bookmarkTileId(bookmark.name),
    data: {
      type: "tile",
      kind: "bookmark",
      name: bookmark.name,
      containerId,
    } satisfies TileData,
  });
  return (
    <BookmarkTile
      name={bookmark.name}
      accent={bookmark.accent}
      variant={bookmark.style ?? DEFAULT_BOOKMARK_STYLE}
      size={resolveBookmarkSize(bookmark)}
      links={bookmark.links}
      kebab={kebab}
      drag={{
        nodeRef: setNodeRef,
        handleRef: setActivatorNodeRef,
        style: { transform: CSS.Translate.toString(transform), transition },
        attributes: attributes as unknown as Record<string, unknown>,
        listeners,
        dragging: isDragging,
        label: `Reorder ${bookmark.name}`,
      }}
    />
  );
}

function DroppableTileGrid({
  containerId,
  columns,
  itemIds,
  activeIsTile,
  children,
}: {
  containerId: string;
  columns?: number;
  itemIds: string[];
  activeIsTile: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: containerId,
    data: { type: "container", containerId } satisfies ContainerData,
  });
  const style =
    columns != null
      ? ({ "--group-columns": columns } as React.CSSProperties)
      : undefined;
  const className =
    "dashboard-tile-grid" +
    (isOver && activeIsTile ? " dashboard-tile-grid--drop-active" : "");
  return (
    <SortableContext items={itemIds} strategy={rectSortingStrategy}>
      <div ref={setNodeRef} className={className} style={style}>
        {children}
      </div>
    </SortableContext>
  );
}

function SortableGroupSection({
  name,
  collapsed,
  headerActions,
  children,
}: {
  name: string;
  collapsed?: boolean;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: groupSortableId(name),
    data: { type: "group", name } satisfies GroupData,
  });
  return (
    <CollapsibleGroup
      name={name}
      defaultCollapsed={collapsed}
      headerActions={headerActions}
      drag={{
        nodeRef: setNodeRef,
        handleRef: setActivatorNodeRef,
        style: { transform: CSS.Translate.toString(transform), transition },
        attributes: attributes as unknown as Record<string, unknown>,
        listeners,
        dragging: isDragging,
      }}
    >
      {children}
    </CollapsibleGroup>
  );
}

// ---- target-index resolution from a drop (kept in the component; the pure
// array mutation lives in @/config/reorder) ----

function keyEq(a: string, b: string): boolean {
  return serviceNameUniquenessKey(a) === serviceNameUniquenessKey(b);
}

/**
 * 0-based position among the target container's same-kind tiles where the
 * moving tile should land, expressed WITHOUT the moving item (moveX ToGroup's
 * contract). Handles: append (dropped on container background or a
 * different-kind tile), same-container reorder (arrayMove, direction-safe),
 * and cross-container insert-before-over.
 */
function computeTargetIndex(
  list: string[],
  movingName: string,
  overData: TileData | ContainerData | undefined,
  sameContainer: boolean,
  kind: "service" | "bookmark"
): number {
  const withoutMoving = list.filter((n) => !keyEq(n, movingName));
  if (!overData || overData.type === "container") return withoutMoving.length;
  if (overData.kind !== kind) return withoutMoving.length;

  if (sameContainer) {
    const oldIdx = list.findIndex((n) => keyEq(n, movingName));
    const newIdx = list.findIndex((n) => keyEq(n, overData.name));
    if (oldIdx === -1 || newIdx === -1) return withoutMoving.length;
    const reordered = arrayMove(list, oldIdx, newIdx);
    return reordered.findIndex((n) => keyEq(n, movingName));
  }
  const overIdx = withoutMoving.findIndex((n) => keyEq(n, overData.name));
  return overIdx === -1 ? withoutMoving.length : overIdx;
}

// Collision detection scoped by drag kind: a group only collides with group
// handles; a tile only collides with tile sortables + section containers.
const collisionDetection: CollisionDetection = (args) => {
  const activeType = args.active.data.current?.type;
  const filtered = args.droppableContainers.filter((c) =>
    activeType === "group"
      ? c.data.current?.type === "group"
      : c.data.current?.type !== "group"
  );
  return closestCenter({ ...args, droppableContainers: filtered });
};

// Which edit dialog (if any) is mounted. `group` is the target section an
// add-flow was launched from (null = ungrouped / no placement).
type ActiveDialog =
  | { kind: "service-edit"; name: string }
  | { kind: "service-add"; group: string | null; preset?: string }
  | { kind: "bookmark-edit"; name: string }
  | { kind: "bookmark-add"; group: string | null }
  | { kind: "add-picker"; group: string | null }
  | null;

export default function EditableServiceGrid({
  config,
}: {
  config: KokpitConfig;
}) {
  const { setServices, setGroups, setBookmarks, updateDraft } = useEditMode();
  const services = config.services;
  const bookmarks = useMemo(() => config.bookmarks ?? [], [config.bookmarks]);
  const declaredGroups = useMemo(() => config.groups ?? [], [config.groups]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ActiveDialog>(null);

  // Group names (declared + auto-appended), de-duped, for the forms' pickers.
  const knownGroupNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const g of resolveGroupOrder(config)) {
      if (g.name === null) continue;
      const k = serviceNameUniquenessKey(g.name);
      if (seen.has(k)) continue;
      seen.add(k);
      names.push(g.name);
    }
    return names;
  }, [config]);

  // ---- B3 staged mutations (all via the B1 setters / updateDraft) ----

  const handleServiceEditSave = useCallback(
    (originalName: string, updated: Service) =>
      setServices(
        services.map((s) => (keyEq(s.name, originalName) ? updated : s))
      ),
    [services, setServices]
  );

  const handleServiceAddSave = useCallback(
    (targetGroup: string | null, created: Service) => {
      const svc =
        created.group || !targetGroup ? created : { ...created, group: targetGroup };
      setServices([...services, svc]);
    },
    [services, setServices]
  );

  const handleServiceDuplicate = useCallback(
    (name: string) => setServices(duplicateService(services, name)),
    [services, setServices]
  );

  const handleServiceRemove = useCallback(
    (name: string) => setServices(services.filter((s) => !keyEq(s.name, name))),
    [services, setServices]
  );

  const handleServiceSize = useCallback(
    (name: string, size: Size) =>
      setServices(
        services.map((s) => (keyEq(s.name, name) ? { ...s, size } : s))
      ),
    [services, setServices]
  );

  const handleBookmarkEditSave = useCallback(
    (originalName: string, updated: BookmarkGroup) =>
      setBookmarks(
        bookmarks.map((b) => (keyEq(b.name, originalName) ? updated : b))
      ),
    [bookmarks, setBookmarks]
  );

  const handleBookmarkAddSave = useCallback(
    (targetGroup: string | null, created: BookmarkGroup) => {
      const bm =
        targetGroup && !created.placement?.group
          ? { ...created, placement: { ...(created.placement ?? {}), group: targetGroup } }
          : created;
      setBookmarks([...bookmarks, bm]);
    },
    [bookmarks, setBookmarks]
  );

  const handleBookmarkDuplicate = useCallback(
    (name: string) => setBookmarks(duplicateBookmark(bookmarks, name)),
    [bookmarks, setBookmarks]
  );

  const handleBookmarkRemove = useCallback(
    (name: string) => setBookmarks(bookmarks.filter((b) => !keyEq(b.name, name))),
    [bookmarks, setBookmarks]
  );

  const handleGroupRename = useCallback(
    (oldName: string, newName: string): boolean => {
      const oldKey = serviceNameUniquenessKey(oldName);
      const newKey = serviceNameUniquenessKey(newName);
      if (newKey === "") return false;
      // Reject a collision with ANOTHER declared group (case-insensitive).
      if (
        newKey !== oldKey &&
        declaredGroups.some((g) => serviceNameUniquenessKey(g.name) === newKey)
      ) {
        return false;
      }
      const patch = renameGroupPatch(
        { groups: declaredGroups, services, bookmarks },
        oldName,
        newName
      );
      if (Object.keys(patch).length > 0) updateDraft(patch);
      migrateGroupCollapseKey(oldName, newName);
      return true;
    },
    [declaredGroups, services, bookmarks, updateDraft]
  );

  const handleGroupColumns = useCallback(
    (name: string, columns: number | undefined) =>
      setGroups(setGroupColumns(declaredGroups, name, columns)),
    [declaredGroups, setGroups]
  );

  const handleGroupDelete = useCallback(
    (name: string) => {
      const patch = deleteGroupPatch(
        { groups: declaredGroups, services, bookmarks },
        name
      );
      if (Object.keys(patch).length > 0) updateDraft(patch);
    },
    [declaredGroups, services, bookmarks, updateDraft]
  );

  const handleGroupDeclare = useCallback(
    (name: string) => setGroups(declareGroup(declaredGroups, name)),
    [declaredGroups, setGroups]
  );

  const buildGroupKebab = useCallback(
    (name: string, declared: boolean, columns?: number) => (
      <GroupKebab
        name={name}
        declared={declared}
        columns={columns}
        onRename={handleGroupRename}
        onColumns={(cols) => handleGroupColumns(name, cols)}
        onDelete={() => handleGroupDelete(name)}
        onAddService={() => setDialog({ kind: "service-add", group: name })}
        onDeclare={() => handleGroupDeclare(name)}
      />
    ),
    [handleGroupRename, handleGroupColumns, handleGroupDelete, handleGroupDeclare]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Bucket services + bookmarks by normalized group key (matches ServiceGrid).
  const layout = useMemo(() => {
    const ungrouped: Service[] = [];
    const servicesByGroup = new Map<string, Service[]>();
    for (const service of services) {
      const groupName = service.group?.trim() ?? "";
      if (groupName === "") {
        ungrouped.push(service);
        continue;
      }
      const key = serviceNameUniquenessKey(groupName);
      const bucket = servicesByGroup.get(key) ?? [];
      bucket.push(service);
      servicesByGroup.set(key, bucket);
    }

    const looseBookmarks: BookmarkGroup[] = [];
    const bookmarksByGroup = new Map<string, BookmarkGroup[]>();
    for (const bookmark of bookmarks) {
      const groupName = bookmark.placement?.group?.trim() ?? "";
      if (groupName === "") {
        looseBookmarks.push(bookmark);
        continue;
      }
      const key = serviceNameUniquenessKey(groupName);
      const bucket = bookmarksByGroup.get(key) ?? [];
      bucket.push(bookmark);
      bookmarksByGroup.set(key, bucket);
    }

    const sections = resolveGroupOrder(config);
    const declaredKeys = new Set(
      declaredGroups.map((g) => serviceNameUniquenessKey(g.name))
    );

    // containerId -> what to assign on drop + current same-kind ordering.
    const containerById = new Map<string, ContainerInfo>();
    const register = (
      id: string,
      group: string | null,
      svc: Service[],
      bms: BookmarkGroup[]
    ) => {
      containerById.set(id, {
        id,
        group,
        serviceNames: svc.map((s) => s.name),
        bookmarkNames: bms.map((b) => b.name),
      });
    };
    register(UNGROUPED_CONTAINER_ID, null, ungrouped, []);
    register(BOOKMARKS_CONTAINER_ID, null, [], looseBookmarks);
    for (const section of sections) {
      if (section.name === null) continue;
      const key = serviceNameUniquenessKey(section.name);
      register(
        groupContainerId(section.name),
        section.name,
        servicesByGroup.get(key) ?? [],
        bookmarksByGroup.get(key) ?? []
      );
    }

    return {
      ungrouped,
      servicesByGroup,
      looseBookmarks,
      bookmarksByGroup,
      sections,
      declaredKeys,
      containerById,
      declaredSortableIds: sections
        .filter((s) => s.name !== null && declaredKeys.has(serviceNameUniquenessKey(s.name)))
        .map((s) => groupSortableId(s.name as string)),
    };
  }, [config, services, bookmarks, declaredGroups]);

  const activeIsTile =
    activeId != null &&
    (activeId.startsWith("service:") || activeId.startsWith("bookmark:"));

  const onDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over) return;
      const activeData = active.data.current as
        | TileData
        | GroupData
        | undefined;
      if (!activeData) return;

      if (activeData.type === "group") {
        const overData = over.data.current as GroupData | undefined;
        if (!overData || overData.type !== "group") return;
        if (keyEq(activeData.name, overData.name)) return;
        setGroups(reorderGroups(declaredGroups, activeData.name, overData.name));
        return;
      }

      const overData = over.data.current as
        | TileData
        | ContainerData
        | undefined;
      const targetContainerId =
        overData?.type === "container"
          ? overData.containerId
          : overData?.type === "tile"
            ? overData.containerId
            : undefined;
      if (!targetContainerId) return;
      const target = layout.containerById.get(targetContainerId);
      if (!target) return;

      const sameContainer = activeData.containerId === targetContainerId;

      if (activeData.kind === "service") {
        const idx = computeTargetIndex(
          target.serviceNames,
          activeData.name,
          overData,
          sameContainer,
          "service"
        );
        const next = moveServiceToGroup(
          services,
          activeData.name,
          target.group,
          idx
        );
        if (next !== services) setServices(next);
      } else {
        const idx = computeTargetIndex(
          target.bookmarkNames,
          activeData.name,
          overData,
          sameContainer,
          "bookmark"
        );
        const next = moveBookmarkToGroup(
          bookmarks,
          activeData.name,
          target.group,
          idx
        );
        if (next !== bookmarks) setBookmarks(next);
      }
    },
    [layout, services, bookmarks, declaredGroups, setServices, setBookmarks, setGroups]
  );

  const onDragCancel = useCallback(() => setActiveId(null), []);

  // Overlay ghost for the active tile (groups reorder in place, no overlay).
  const overlay = useMemo(() => {
    if (!activeId) return null;
    if (activeId.startsWith("service:")) {
      const name = activeId.slice("service:".length);
      const service = services.find((s) => keyEq(s.name, name));
      if (!service) return null;
      return <ServiceTile {...serviceTileProps(service)} preview />;
    }
    if (activeId.startsWith("bookmark:")) {
      const name = activeId.slice("bookmark:".length);
      const bookmark = bookmarks.find((b) => keyEq(b.name, name));
      if (!bookmark) return null;
      return (
        <BookmarkTile
          name={bookmark.name}
          accent={bookmark.accent}
          variant={bookmark.style ?? DEFAULT_BOOKMARK_STYLE}
          size={resolveBookmarkSize(bookmark)}
          links={bookmark.links}
        />
      );
    }
    return null;
  }, [activeId, services, bookmarks]);

  const serviceKebab = (service: Service) => {
    const hints = service.widget
      ? getWidgetSizeHints(service.widget.type)
      : undefined;
    return (
      <ServiceTileMenu
        name={service.name}
        size={resolveServiceSize(service, hints?.preferredSize, hints?.minSize)}
        minSize={hints?.minSize}
        onEdit={() => setDialog({ kind: "service-edit", name: service.name })}
        onSize={(size) => handleServiceSize(service.name, size)}
        onDuplicate={() => handleServiceDuplicate(service.name)}
        onRemove={() => handleServiceRemove(service.name)}
      />
    );
  };

  const bookmarkKebab = (bookmark: BookmarkGroup) => (
    <BookmarkTileMenu
      name={bookmark.name}
      onEdit={() => setDialog({ kind: "bookmark-edit", name: bookmark.name })}
      onDuplicate={() => handleBookmarkDuplicate(bookmark.name)}
      onRemove={() => handleBookmarkRemove(bookmark.name)}
    />
  );

  const renderSectionTiles = (
    containerId: string,
    sectionServices: Service[],
    sectionBookmarks: BookmarkGroup[],
    addTarget: string | null
  ) => (
    <>
      {sectionServices.map((service) => (
        <SortableServiceTile
          key={`service:${service.name}`}
          service={service}
          containerId={containerId}
          kebab={serviceKebab(service)}
        />
      ))}
      {sectionBookmarks.map((bookmark) => (
        <SortableBookmarkTile
          key={`bookmark:${bookmark.name}`}
          bookmark={bookmark}
          containerId={containerId}
          kebab={bookmarkKebab(bookmark)}
        />
      ))}
      <button
        type="button"
        className="dashboard-add-tile"
        aria-label={addTarget ? `Add tile to ${addTarget}` : "Add tile"}
        onClick={() => setDialog({ kind: "add-picker", group: addTarget })}
      >
        <span className="dashboard-add-tile__plus" aria-hidden="true">
          +
        </span>
        <span className="dashboard-add-tile__label">Add tile</span>
      </button>
    </>
  );

  const sectionItemIds = (
    sectionServices: Service[],
    sectionBookmarks: BookmarkGroup[]
  ) => [
    ...sectionServices.map((s) => serviceTileId(s.name)),
    ...sectionBookmarks.map((b) => bookmarkTileId(b.name)),
  ];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <SortableContext
        items={layout.declaredSortableIds}
        strategy={verticalListSortingStrategy}
      >
        {layout.sections.map((section) => {
          if (section.name === null) {
            return (
              <DroppableTileGrid
                key="__ungrouped__"
                containerId={UNGROUPED_CONTAINER_ID}
                itemIds={sectionItemIds(layout.ungrouped, [])}
                activeIsTile={activeIsTile}
              >
                {renderSectionTiles(
                  UNGROUPED_CONTAINER_ID,
                  layout.ungrouped,
                  [],
                  null
                )}
              </DroppableTileGrid>
            );
          }

          const key = serviceNameUniquenessKey(section.name);
          const sectionServices = layout.servicesByGroup.get(key) ?? [];
          const sectionBookmarks = layout.bookmarksByGroup.get(key) ?? [];
          const containerId = groupContainerId(section.name);
          const declared = layout.declaredKeys.has(key);
          const grid = (
            <DroppableTileGrid
              containerId={containerId}
              columns={section.columns}
              itemIds={sectionItemIds(sectionServices, sectionBookmarks)}
              activeIsTile={activeIsTile}
            >
              {renderSectionTiles(
                containerId,
                sectionServices,
                sectionBookmarks,
                section.name
              )}
            </DroppableTileGrid>
          );

          const kebab = buildGroupKebab(section.name, declared, section.columns);

          // Only declared groups are drag-reorderable; auto-appended groups
          // render as pinned (non-draggable) sections. Both get a group kebab.
          if (declared) {
            return (
              <SortableGroupSection
                key={section.name}
                name={section.name}
                collapsed={section.collapsed}
                headerActions={kebab}
              >
                {grid}
              </SortableGroupSection>
            );
          }
          return (
            <CollapsibleGroup
              key={section.name}
              name={section.name}
              defaultCollapsed={section.collapsed}
              headerActions={kebab}
            >
              {grid}
            </CollapsibleGroup>
          );
        })}

        {layout.looseBookmarks.length > 0 && (
          <CollapsibleGroup name="Bookmarks">
            <DroppableTileGrid
              containerId={BOOKMARKS_CONTAINER_ID}
              itemIds={sectionItemIds([], layout.looseBookmarks)}
              activeIsTile={activeIsTile}
            >
              {renderSectionTiles(
                BOOKMARKS_CONTAINER_ID,
                [],
                layout.looseBookmarks,
                null
              )}
            </DroppableTileGrid>
          </CollapsibleGroup>
        )}

        {/* Always-available add affordance (also covers an empty dashboard). */}
        <div className="dashboard-tile-grid dashboard-tile-grid--add-row">
          <button
            type="button"
            className="dashboard-add-tile dashboard-add-tile--standalone"
            onClick={() => setDialog({ kind: "add-picker", group: null })}
          >
            <span className="dashboard-add-tile__plus" aria-hidden="true">
              +
            </span>
            <span className="dashboard-add-tile__label">Add tile</span>
          </button>
        </div>
      </SortableContext>

      <DragOverlay className="tile-drag-overlay">{overlay}</DragOverlay>

      {renderDialog()}
    </DndContext>
  );

  function renderDialog() {
    if (!dialog) return null;
    const close = () => setDialog(null);

    if (dialog.kind === "add-picker") {
      return (
        <AddTilePicker
          targetGroup={dialog.group}
          onClose={close}
          onPick={(choice: AddChoice) => {
            if (choice.kind === "service") {
              setDialog({ kind: "service-add", group: dialog.group });
            } else if (choice.kind === "preset") {
              setDialog({
                kind: "service-add",
                group: dialog.group,
                preset: choice.preset,
              });
            } else {
              setDialog({ kind: "bookmark-add", group: dialog.group });
            }
          }}
        />
      );
    }

    if (dialog.kind === "service-edit") {
      const service = services.find((s) => keyEq(s.name, dialog.name));
      if (!service) return null;
      return (
        <ServiceForm
          service={service}
          existingGroups={knownGroupNames}
          takenNames={services
            .filter((s) => !keyEq(s.name, dialog.name))
            .map((s) => s.name)}
          onSave={(updated) => {
            handleServiceEditSave(dialog.name, updated);
            close();
          }}
          onClose={close}
        />
      );
    }

    if (dialog.kind === "service-add") {
      return (
        <ServiceForm
          service={null}
          existingGroups={knownGroupNames}
          takenNames={services.map((s) => s.name)}
          initialGroup={dialog.group ?? undefined}
          initialPreset={dialog.preset}
          onSave={(created) => {
            handleServiceAddSave(dialog.group, created);
            close();
          }}
          onClose={close}
        />
      );
    }

    if (dialog.kind === "bookmark-edit") {
      const bookmark = bookmarks.find((b) => keyEq(b.name, dialog.name));
      if (!bookmark) return null;
      return (
        <BookmarkGroupForm
          bookmark={bookmark}
          knownGroups={knownGroupNames}
          takenNames={bookmarks
            .filter((b) => !keyEq(b.name, dialog.name))
            .map((b) => b.name)}
          onSave={(updated) => {
            handleBookmarkEditSave(dialog.name, updated);
            close();
          }}
          onClose={close}
        />
      );
    }

    if (dialog.kind === "bookmark-add") {
      return (
        <BookmarkGroupForm
          bookmark={null}
          knownGroups={knownGroupNames}
          takenNames={bookmarks.map((b) => b.name)}
          initialGroup={dialog.group ?? undefined}
          onSave={(created) => {
            handleBookmarkAddSave(dialog.group, created);
            close();
          }}
          onClose={close}
        />
      );
    }

    return null;
  }
}
