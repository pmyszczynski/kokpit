// Pure, client-safe resolution of an icon field into a concrete image URL.
// Sibling to resolve.ts (layout-only); kept separate because this is icon-only
// and has no config/layout dependencies. No I/O — safe on both server and
// client, and unit-testable in isolation.

/**
 * A resolved icon reference. `kind` distinguishes a value that was expanded
 * from a `sh-`/`di-`/`mdi-` shorthand from one passed through unchanged (a
 * plain URL or an uploaded-icon path).
 */
export interface ResolvedIconRef {
  kind: "url" | "shorthand";
  url: string;
}

// Shorthand prefix → CDN URL builder. All three resolve to the SVG asset on
// jsDelivr; the same CDN + SSRF-guarded cache layer already used by
// iconLibraries.ts. Adding a prefix here is the only change needed to support
// a new shorthand source.
const SHORTHAND_BUILDERS = new Map<string, (slug: string) => string>([
  ["sh", (slug) => `https://cdn.jsdelivr.net/gh/selfhst/icons/svg/${slug}.svg`],
  ["di", (slug) => `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${slug}.svg`],
  ["mdi", (slug) => `https://cdn.jsdelivr.net/npm/@mdi/svg/svg/${slug}.svg`],
]);

// A shorthand slug is a single icon name segment. Restricting it to this set
// (no slashes, no dots, no colons) keeps an expanded shorthand from smuggling
// a path-traversal segment or a full URL into the CDN path; anything outside
// it falls through to passthrough and renders (or fails to render) exactly as
// the raw string would have before this resolver existed.
const SLUG_PATTERN = /^[a-z0-9_-]+$/i;

/**
 * Resolves an icon field to an image URL.
 *
 * - `sh-<slug>`  → selfh.st icons
 * - `di-<slug>`  → dashboard-icons
 * - `mdi-<slug>` → Material Design Icons
 * - anything else (a value containing `://`, a leading `/`, an unknown prefix,
 *   or a malformed slug) → returned **unchanged** as a plain URL.
 *
 * The passthrough branch preserves every existing config byte-for-byte: plain
 * icon URLs and uploaded-icon paths (`/api/icons/user/…`) are never rewritten.
 */
export function resolveIconRef(icon: string): ResolvedIconRef {
  const trimmed = icon.trim();
  if (trimmed === "" || trimmed.includes("://") || trimmed.startsWith("/")) {
    return { kind: "url", url: icon };
  }

  const dash = trimmed.indexOf("-");
  if (dash > 0) {
    const prefix = trimmed.slice(0, dash);
    const slug = trimmed.slice(dash + 1);
    const build = SHORTHAND_BUILDERS.get(prefix);
    if (build && SLUG_PATTERN.test(slug)) {
      return { kind: "shorthand", url: build(slug) };
    }
  }

  return { kind: "url", url: icon };
}
