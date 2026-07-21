// Pure clone logic for the edit-mode tile kebab "Duplicate" action (Work
// Package B3). The moving/cloned object is preserved intact apart from its
// name; every other item keeps its identity and position. Headless and
// unit-tested (the component just calls these + stages the result).
import {
  serviceNameUniquenessKey,
  type BookmarkGroup,
  type Service,
} from "./schema";

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
  const idx = indexByName(services, name);
  if (idx === -1) return services;
  const original = services[idx];
  const clone: Service = {
    ...original,
    name: uniqueCopyName(original.name, services.map((s) => s.name)),
    // Deep-clone the widget so the copy can never mutate the original's
    // nested `config`/`fields` (same guarantee duplicateBookmark gives links).
    ...(original.widget
      ? {
          widget: {
            ...original.widget,
            ...(original.widget.config
              ? { config: { ...original.widget.config } }
              : {}),
            ...(original.widget.fields
              ? { fields: [...original.widget.fields] }
              : {}),
          },
        }
      : {}),
  };
  const next = [...services];
  next.splice(idx + 1, 0, clone);
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
