"use client";

// Edit-mode dashboard render, bound to the client draft instead of the server
// config. For B1 this is a static mirror of ServiceGrid: same group order, same
// tiles, same bookmark placement — but every tile renders in `preview` mode
// (no status/widget polling) and there is NO drag chrome and NO kebab yet
// (those are B2/B3). It proves the draft renders; interactivity comes later.
import "@/integrations";
import {
  DEFAULT_BOOKMARK_STYLE,
  resolveGroupOrder,
  resolveServiceSize,
} from "@/config/resolve";
import {
  serviceNameUniquenessKey,
  type BookmarkGroup,
  type KokpitConfig,
  type Service,
  type ServiceWidget,
  type Size,
} from "@/config/schema";
import { getWidget, getWidgetSizeHints } from "@/widgets";
import BookmarkTile from "../BookmarkTile";
import CollapsibleGroup from "../CollapsibleGroup";
import ServiceTile, { type TileWidget } from "../ServiceTile";

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
      size={resolveServiceSize(service, hints?.preferredSize, hints?.minSize)}
      preview
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

export default function EditableServiceGrid({
  config,
}: {
  config: KokpitConfig;
}) {
  const services = config.services;
  const bookmarks = config.bookmarks ?? [];

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

  const sections = resolveGroupOrder(config);

  return (
    <>
      {sections.map((section) => {
        if (section.name === null) {
          return (
            <div key="__ungrouped__" className="dashboard-tile-grid">
              {ungrouped.map(renderServiceTile)}
            </div>
          );
        }

        const key = serviceNameUniquenessKey(section.name);
        const sectionServices = servicesByGroup.get(key) ?? [];
        const sectionBookmarks = bookmarksByGroup.get(key) ?? [];
        // Unlike view mode, keep declared-but-empty groups visible so the user
        // can see (and later, in B3, fill) them.
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
        <CollapsibleGroup name="Bookmarks">
          <TileGrid>{looseBookmarks.map(renderBookmarkTile)}</TileGrid>
        </CollapsibleGroup>
      )}
    </>
  );
}
