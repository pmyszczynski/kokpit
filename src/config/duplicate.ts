// Pure clone logic for the edit-mode tile kebab "Duplicate" action (Work
// Package B3). The moving/cloned object is preserved intact apart from its
// name; every other item keeps its identity and position. Headless and
// unit-tested (the component just calls these + stages the result).
import {
  serviceNameUniquenessKey,
  widgetIntegrationRequirement,
  type BookmarkGroup,
  type Service,
} from "./schema";
import { isWidgetConfigReference, isWidgetSecretReference } from "@/widgets/secretReference";
import { generateUuid } from "./uuid";

const UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY = "__kokpit_widget_config_reference__";

function cloneConfigWithoutReferences(value: unknown): unknown {
  if (isWidgetSecretReference(value)) return undefined;
  if (isWidgetConfigReference(value)) return undefined;
  if (Array.isArray(value)) {
    return value
      .map(cloneConfigWithoutReferences)
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== UNKNOWN_WIDGET_CONFIG_REFERENCE_KEY)
        .map(([key, item]) => [key, cloneConfigWithoutReferences(item)])
        .filter(([, item]) => item !== undefined)
    );
  }
  return value;
}

/**
 * A unique copy name for `base` that collides with none of `taken`
 * (compared case-insensitively via serviceNameUniquenessKey). Tries
 * `"<base> copy"` first, then `"<base> copy 2"`, `"<base> copy 3"`, …
 */
export function uniqueCopyName(base: string, taken: string[]): string {
  const takenKeys = new Set(taken.map(serviceNameUniquenessKey));
  const first = `${base} copy`;
  if (!takenKeys.has(serviceNameUniquenessKey(first))) return first;
  let n = 2;
  while (takenKeys.has(serviceNameUniquenessKey(`${base} copy ${n}`))) n++;
  return `${base} copy ${n}`;
}

function indexByName<T extends { name: string }>(items: T[], name: string): number {
  const key = serviceNameUniquenessKey(name);
  return items.findIndex((i) => serviceNameUniquenessKey(i.name) === key);
}

/**
 * Duplicate the named service, inserting the clone directly after the original
 * with a unique name. Returns the original array unchanged if the name is
 * unknown.
 */
export function duplicateService(services: Service[], name: string): Service[] {
  const idx = services.findIndex((service) => service.tileId === name || service.id === name);
  const resolvedIndex = idx === -1 ? indexByName(services, name) : idx;
  if (resolvedIndex === -1) return services;
  const original = services[resolvedIndex];
  const {
    editorIntegrationConfig: _editorIntegrationConfig,
    editorTileWidgetConfig: _editorTileWidgetConfig,
    ...cloneSource
  } = original;
  const clone: Service = {
    ...cloneSource,
    id: generateUuid(),
    tileId: generateUuid(),
    ...(original.integration || original.editorIntegrationConfig
      ? {
          editorIntegration: {
            command: "set" as const,
            type: original.integration?.type ??
              (original.widget ? widgetIntegrationRequirement(original.widget.type) ?? "" : ""),
            config: cloneConfigWithoutReferences(
              original.editorIntegrationConfig ?? original.integration?.config ?? {}
            ) as Record<string, unknown>,
          },
        }
      : {}),
    name: uniqueCopyName(original.name, services.map((s) => s.name)),
    // Deep-clone the widget so the copy can never mutate the original's
    // nested `config`/`fields` (same guarantee duplicateBookmark gives links).
    ...(original.widget
      ? {
          widget: {
            ...original.widget,
            ...(original.widget.config
              ? { config: cloneConfigWithoutReferences(original.widget.config) as Record<string, unknown> }
              : {}),
            ...(original.widget.fields
              ? { fields: [...original.widget.fields] }
              : {}),
          },
        }
      : {}),
  };
  const next = [...services];
  next.splice(resolvedIndex + 1, 0, clone);
  return next;
}

/**
 * Duplicate the named bookmark group, inserting the clone directly after the
 * original with a unique name. Links/accent/style/placement are preserved.
 */
export function duplicateBookmark(
  bookmarks: BookmarkGroup[],
  name: string
): BookmarkGroup[] {
  const idx = indexByName(bookmarks, name);
  if (idx === -1) return bookmarks;
  const original = bookmarks[idx];
  const clone: BookmarkGroup = {
    ...original,
    name: uniqueCopyName(original.name, bookmarks.map((b) => b.name)),
    ...(original.placement ? { placement: { ...original.placement } } : {}),
    links: original.links.map((l) => ({ ...l })),
  };
  const next = [...bookmarks];
  next.splice(idx + 1, 0, clone);
  return next;
}
