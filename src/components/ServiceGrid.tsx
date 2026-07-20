// Populate the widget registry server-side so widget configs can be
// validated (and size hints looked up) before rendering tiles.
import "@/integrations";
import { getConfig } from "@/config";
import {
  DEFAULT_BOOKMARK_STYLE,
  resolveGroupOrder,
  resolveServiceSize,
} from "@/config/resolve";
import {
  serviceNameUniquenessKey,
  type BookmarkGroup,
  type Service,
  type ServiceWidget,
  type Size,
} from "@/config/schema";
import { getWidget, getWidgetSizeHints } from "@/widgets";
import BookmarkTile from "./BookmarkTile";
import CollapsibleGroup from "./CollapsibleGroup";
import ServiceTile, { TileWidget } from "./ServiceTile";

// Decide what the client tile gets to see of a service's widget:
// - no widget → nothing
// - unknown type → sanitized pass-through, so the renderer surfaces the typo
// - known type with valid config → sanitized widget
// - known type with missing/invalid config → nothing (plain link tile)
// Config (credentials) never leaves the server either way.
function resolveTileWidget(widget?: ServiceWidget): TileWidget | undefined {
  if (!widget) return undefined;
  const def = getWidget(widget.type);
  if (def && !def.configSchema.safeParse(widget.config ?? {}).success) {
    return undefined;
  }
  return {
    type: widget.type,
    refresh_interval_ms: widget.refresh_interval_ms,
  };
}

/**
 * Default tile size for a bookmark group without an explicit
 * `placement.size`:
 * - `list` → `tall` (vertical rows earn the second row)
 * - `icon-grid` → `normal` (icons pack many links into one cell)
 * - `compact` → `normal` (two text columns fit one cell)
 */
function resolveBookmarkSize(bookmark: BookmarkGroup): Size {
  if (bookmark.placement?.size) return bookmark.placement.size;
  const style = bookmark.style ?? DEFAULT_BOOKMARK_STYLE;
  return style === "list" ? "tall" : "normal";
}

function renderServiceTile(service: Service) {
  const hints = service.widget
    ? getWidgetSizeHints(service.widget.type)
    : undefined;
  return (
    <ServiceTile
      key={`service:${service.name}`}
      name={service.name}
      url={service.url}
      icon={service.icon}
      description={service.description}
      widget={resolveTileWidget(service.widget)}
      size={resolveServiceSize(service, hints?.preferredSize)}
    />
  );
}

function renderBookmarkTile(bookmark: BookmarkGroup) {
  return (
    <BookmarkTile
      key={`bookmark:${bookmark.name}`}
      name={bookmark.name}
      accent={bookmark.accent}
      variant={bookmark.style ?? DEFAULT_BOOKMARK_STYLE}
      size={resolveBookmarkSize(bookmark)}
      links={bookmark.links}
    />
  );
}

function TileGrid({
  columns,
  children,
}: {
  /** Per-group column override (`groups[].columns`) → CSS variable. */
  columns?: number;
  children: React.ReactNode;
}) {
  const style =
    columns != null
      ? ({ "--group-columns": columns } as React.CSSProperties)
      : undefined;
  return (
    <div className="dashboard-tile-grid" style={style}>
      {children}
    </div>
  );
}

export default function ServiceGrid() {
  const config = getConfig();
  const services = config.services;
  const bookmarks = config.bookmarks ?? [];

  if (services.length === 0 && bookmarks.length === 0) {
    return null;
  }

  // Bucket services by normalized group key (matches resolveGroupOrder's
  // case-insensitive group matching).
  const ungrouped: Service[] = [];
  const servicesByGroup = new Map<string, Service[]>();
  for (const service of services) {
    const groupName = service.group?.trim() ?? "";
    if (groupName === "") {
      ungrouped.push(service);
      continue;
    }
    const key = serviceNameUniquenessKey(groupName);
    const existing = servicesByGroup.get(key) ?? [];
    existing.push(service);
    servicesByGroup.set(key, existing);
  }

  // Bookmark groups: `placement.group` pins the tile into that group
  // (appended after the group's services); without it the tile goes to an
  // implicit "Bookmarks" section rendered after everything else.
  const looseBookmarks: BookmarkGroup[] = [];
  const bookmarksByGroup = new Map<string, BookmarkGroup[]>();
  for (const bookmark of bookmarks) {
    const groupName = bookmark.placement?.group?.trim() ?? "";
    if (groupName === "") {
      looseBookmarks.push(bookmark);
      continue;
    }
    const key = serviceNameUniquenessKey(groupName);
    const existing = bookmarksByGroup.get(key) ?? [];
    existing.push(bookmark);
    bookmarksByGroup.set(key, existing);
  }

  // Declared `groups:` order, auto-appended referenced groups, and the
  // implicit ungrouped section placed per `layout.ungrouped`.
  const sections = resolveGroupOrder(config);

  return (
    <>
      {sections.map((section) => {
        if (section.name === null) {
          // Implicit ungrouped section: bare tile grid, no header/collapse.
          return (
            <div key="__ungrouped__" className="dashboard-tile-grid">
              {ungrouped.map(renderServiceTile)}
            </div>
          );
        }

        const key = serviceNameUniquenessKey(section.name);
        const sectionServices = servicesByGroup.get(key) ?? [];
        const sectionBookmarks = bookmarksByGroup.get(key) ?? [];
        if (sectionServices.length === 0 && sectionBookmarks.length === 0) {
          // Declared group with no members yet — nothing to render in view mode.
          return null;
        }

        return (
          <CollapsibleGroup
            key={section.name}
            name={section.name}
            defaultCollapsed={section.collapsed}
          >
            <TileGrid columns={section.columns}>
              {sectionServices.map(renderServiceTile)}
              {sectionBookmarks.map(renderBookmarkTile)}
            </TileGrid>
          </CollapsibleGroup>
        );
      })}
      {looseBookmarks.length > 0 && (
        // Bookmarks without placement.group land in an implicit "Bookmarks"
        // section, always last — after the ungrouped section regardless of
        // layout.ungrouped.
        <CollapsibleGroup name="Bookmarks">
          <TileGrid>{looseBookmarks.map(renderBookmarkTile)}</TileGrid>
        </CollapsibleGroup>
      )}
    </>
  );
}
