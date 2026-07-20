# Dashboard Creation & Editing UX — Redesign Proposal

**Status:** Phase A implemented on branch `claude/dashboard-creation-ux-i0v4vs` (schema, resolve-time defaults, settings panel Groups/Bookmarks tabs). Phase B (edit mode) and Phase C (polish pass) are pending.
**Date:** 2026-07-20
**Scope:** Dashboard layout, tile sizing, ordering, in-place editing, bookmarks, visual polish. Design + architecture only.

---

## 1. Summary

Kokpit's dashboard today is a wall of identical 1×1 tiles, ordered by YAML array
position, grouped by alphabetically-sorted free-text labels, and editable only
through the settings panel. This proposal turns the dashboard itself into the
editor: a size system that breaks tile monotony, groups as first-class orderable
entities, an edit mode with drag-to-reorder and per-tile configuration, and a
bookmark-group tile for storing plain links.

The strategic position that emerged from researching Homepage, Homarr, Heimdall,
Dashy and Glance: **the market has an open gap for GUI editing that persists to a
human-readable config file.** Homarr is the best GUI editor but is DB-only (its
most-cited drawback — no git diff, separate backups); Homepage and Glance are
beloved but YAML-only (drag-and-drop is their loudest feature request, spawning
third-party GUI editors). Dashy attempts both and its own docs admit the live
editor is its least reliable path. Kokpit already has the hard part built —
`writeConfig()` round-trips YAML preserving comments and formatting, and a file
watcher hot-reloads external edits. Building the GUI editor on top of that
existing two-way file sync is the differentiator: **"Homarr's editing ergonomics,
Homepage's config file."**

---

## 2. Where we are today (condensed)

- Pure CSS Grid, two nested grids; every tile is one fixed cell of
  `row_height` px (default 120) × 1 column (`globals.css:240–298`).
- Groups are free-text strings on services; rendered alphabetically, ungrouped
  last; no group entity, no ordering, no collapsing (`ServiceGrid.tsx:27`).
- Tile order within a group = YAML array order; no UI control anywhere.
- All editing happens in `/settings` (tabbed panel + ServiceForm dialog). The
  dashboard itself is read-only apart from clicking links.
- A `position: {col,row,width,height}` field exists in the schema but no UI sets
  it — dead config surface, hand-edit only, CSS-neutralized on mobile.
- No bookmark/link concept: every link is a full service tile.
- Widgets always live inline on a service; invalid widget config silently
  downgrades the tile to a plain link (`resolveTileWidget`, `ServiceGrid.tsx:15`).
- Config flow that works in our favor: server components read `settings.yaml`
  via cached loader; in-app edits `PATCH /api/settings` → Zod-validated →
  `writeConfig()` (comment-preserving YAML write) → cache invalidation;
  `fs.watch` picks up hand edits.

---

## 3. UX issues inventory

Issues 1–5 were reported by the user; 6–17 were found during the audit.

| # | Issue | Severity |
|---|-------|----------|
| **U1** | All tiles are one size/shape; several widgetless tiles look like a bland uniform wall (the "Heimdall look" the ecosystem evolved away from). | High |
| **U2** | Groups cannot be ordered — they render alphabetically, ungrouped always last. Order is arbitrary and uncontrollable. | High |
| **U3** | Tiles cannot be ordered by the user except by hand-rearranging the YAML array. | High |
| **U4** | Tiles are not configurable from the dashboard — every change is a trip to `/settings` → Services tab → table row → dialog → back. | High |
| **U5** | No good place to store plain links; every link costs a full service tile. | High |
| 6 | Fixed 120 px row height fights widget content: widgets get `overflow: hidden` and clip; link-only tiles waste the same vertical budget a widget tile gets. Size and information density are not coupled. | High |
| 7 | No empty state: with zero services `ServiceGrid` returns `null` — a blank page with no onboarding path for the first-run experience. | Medium |
| 8 | Invalid widget config silently downgrades the tile to a plain link with zero feedback; the user thinks the widget vanished. | Medium |
| 9 | The `position` field is schema-supported but has no UI, no docs presence, and is ignored on mobile — a trap for anyone who discovers it. | Medium |
| 10 | Status dot is reachability-only (any HTTP response = green), has no tooltip (no response time, no status code), and every open browser tab pings every service every 30 s independently — N tabs × M services of duplicate probes. | Medium |
| 11 | No "add service" affordance on the dashboard itself; adding your 2nd–20th service means repeated settings round-trips. | Medium |
| 12 | Groups can't be collapsed; a long dashboard is one uninterrupted scroll. | Low |
| 13 | Icon experience is weak: URL-or-nothing, favicon fallback, letter fallback. No search over dashboard-icons/selfh.st (roadmap P1), so real dashboards end up letter-tile heavy. | Medium |
| 14 | No visual hierarchy tools at all: no background image, no card blur/glass, tiles have uniform chrome. Themes exist but only recolor. | Medium |
| 15 | Mobile has no editing story whatsoever (acceptable short-term, but the redesign must not make it worse — Homarr's documented failure mode is drag-and-drop that doesn't work on touch). | Low |
| 16 | Save model in settings is per-tab with instant writes — fine for forms, wrong for layout: there is no way to stage several layout moves and commit or discard them together. | Medium |
| 17 | No quick way to find a service on a large dashboard (⌘K launcher is roadmap P4; noting here because edit mode + search share the "command surface" design). | Low |

---

## 4. What the peers taught us (condensed)

Full research notes are in the PR discussion; the load-bearing findings:

- **Tile hierarchy beats tile uniformity.** Homepage and Glance screenshots look
  *designed* because they mix tiers: info/header row → big widget tiles →
  medium service tiles → compact bookmark columns. Heimdall looks dated because
  everything is the same tile. → Kokpit needs size *tiers*, not just size *knobs*.
- **Constrained sizing gets 90 % of the value.** Dashy's `small|medium|large`
  item presets + section spans prove you don't need Homarr's free-form gridstack
  canvas to break monotony — and presets stay predictable, reflow on mobile for
  free, and serialize to readable YAML.
- **Ordering is the #1 thing users refuse to do in a text file.** Homepage's
  discussion board is full of drag-and-drop requests; third-party GUI editors
  exist purely to reorder its YAML.
- **Homarr's edit-mode loop is the reference:** explicit toggle (+ `Mod+E`),
  staged changes committed on exit, per-tile kebab menu → edit modal, add-item
  button in the header, gridstack snap. Its two honest touch fallbacks: a
  numeric move/resize modal, and a separate mobile layout.
- **Bookmarks: two-tier is correct.** Homepage's separate `bookmarks` namespace
  (visibly smaller, 2-letter abbr fallback) is the benchmark; Homarr's insight
  is that *a bookmark group is itself one grid tile* with selectable internal
  layout (icon grid ↔ list); Glance's per-group accent color makes link lists
  scannable and is a signature of its praised aesthetic.
- **Polish table stakes in 2026:** dashboard-icons + selfh.st shorthand
  prefixes, status dots with hover detail, background image + card blur,
  collapsible groups.

---

## 5. Design principles

1. **`settings.yaml` stays the single source of truth.** The GUI is a frontend
   for the file. Every edit-mode action must serialize to YAML a human would
   plausibly have written — which rules out per-breakpoint absolute coordinates.
2. **The dashboard is the editor.** Settings keeps global concerns (auth,
   theme, layout defaults); everything about *a tile* or *the arrangement* is
   done in place.
3. **Flow, not free-form.** Order + size spans in an auto-flowing grid, not
   absolute x/y positioning. Reflows across breakpoints for free, keeps YAML
   diffable, avoids Homarr's touch-editing and mobile-layout problems.
4. **Size = information density.** A bigger tile doesn't just stretch — it
   earns more content (description, widget, more widget rows). Small tiles shed
   content gracefully.
5. **Staged edits, atomic save.** Edit mode accumulates changes client-side;
   exit commits one YAML write (one clean git diff) or discards.
6. **View mode is sacred.** Outside edit mode the dashboard is stable and
   read-only; casual viewers can't wreck a layout.

---

## 6. Proposed experience

### 6.1 Tile size system (fixes U1, #6)

Replace "every tile = 1 cell" with **named size presets**, each a col×row span
in the existing CSS grid (`grid-auto-flow: dense` for gap filling):

| Preset | Span (cols×rows) | Content shown |
|--------|------------------|---------------|
| `normal` (default) | 1×1 | icon, name, description, status |
| `wide` | 2×1 | + widget summary row (stat strip) |
| `tall` | 1×2 | + vertical widget (queues, lists) |
| `large` | 2×2 | full widget canvas |

- **Decision (2026-07-20):** no half-height `compact` preset. Services always
  occupy at least one full row; link density is the job of bookmark-group
  tiles (§6.5). This keeps the grid on whole-row units — no half-row math.
- Default sizing is **smart**: a service with no widget defaults to `normal`;
  attaching a widget suggests the widget's preferred size (each
  `WidgetDefinition` gains a `preferredSize`/`minSize` hint — e.g.
  `qbittorrent-torrents` → `tall`, `netdata-cpu` → `normal` with sparkline).
- Widgets adapt to size rather than clip: definitions may ship a compact
  variant (single stat + sparkline) and an expanded variant. Minimum viable
  version: widgets declare `minSize` and the size picker greys out sizes below it.

**Deprecate `position`** (#9): migrate any existing `position` values to the
nearest size preset + array order on load, warn in the validator, remove the
field at the next `schema_version` bump.

### 6.2 Groups as first-class entities (fixes U2, #12)

New top-level `groups:` array — array order **is** display order:

```yaml
groups:
  - name: Media
    collapsed: false          # default expanded; state persisted per-browser
    columns: 4                # optional per-group column override
  - name: Downloads
  - name: Infrastructure
```

- Services keep their `group: Media` string reference — **no breaking change**.
  Groups referenced by services but missing from `groups:` are auto-appended
  (current alphabetical behavior becomes the fallback, so existing configs
  render identically until the user starts ordering).
- Ungrouped services render as an implicit section whose placement is
  **user-configurable**: `layout.ungrouped: first | last` (default `last`,
  matching today's behavior).
- Group headers get a collapse chevron in view mode; collapsed state is
  localStorage (per-device preference), the `collapsed` key only sets default.
- In edit mode, group headers become drag handles for reordering whole groups,
  and each header gains a kebab: rename (updates all member services), set
  columns, delete (moves members to ungrouped), add-service-here.

### 6.3 Edit mode (fixes U3, U2, #11, #16)

The centerpiece. Modeled on Homarr's loop, adapted to file persistence:

- **Enter:** pencil toggle in the navbar + `Mod+E`. Only when authenticated
  (same guard as `/api/settings` today).
- **In edit mode:**
  - Tiles get a subtle wiggle-free affordance (dashed outline + grab cursor —
    not iOS jiggle), a **drag handle** (whole tile is draggable), and a
    **kebab menu** (see 6.4).
  - Drag to reorder within a group and **across groups** (drop into another
    group's grid reassigns `group:`); drag group headers to reorder groups.
  - **"+ Add" button** in the navbar: searchable picker of tile types —
    Service / the 21 widget presets (reusing `serviceEditorPreset`) / Bookmark
    group — dropped into the grid at the end of a chosen group, then the
    edit dialog opens.
  - A persistent **edit bar** (bottom or top): `● 4 unsaved changes  [Discard] [Save & exit]`.
- **Exit:** *Save & exit* serializes the staged state to one `PATCH
  /api/settings` call → one comment-preserving YAML write. *Discard* (or `Esc`
  with confirm) restores the server state. This fixes the missing
  stage/commit semantics (#16) and gives clean git diffs.
- **Conflict safety:** the edit session captures the config revision on entry;
  if the file watcher detects an external change mid-session, show a
  non-blocking banner ("settings.yaml changed on disk — review before saving")
  and require an explicit overwrite/reload choice on save.
- **Mobile/touch:** don't ship broken drag. Edit mode on touch shows per-tile
  ▲▼ / "move to group…" controls in the kebab instead of drag (Homarr's numeric
  modal, but friendlier). Reordering via buttons is clunky but *works*, which
  beats drag that doesn't.

### 6.4 In-place tile configuration (fixes U4, #8)

In edit mode, every tile's kebab menu offers:

- **Edit** — opens the *existing* `ServiceForm` dialog (name, URL, icon,
  description, group, widget config, test connection). One form, two entry
  points; no new form to build or keep in sync.
- **Size** — inline preset picker (the five presets as mini-shape icons,
  unavailable sizes greyed by widget `minSize`).
- **Duplicate** and **Remove** (staged like everything else).

Two touches outside edit mode:

- A faint hover-revealed pencil on each tile (auth'd users only) that
  deep-links into edit mode with that tile's dialog open — the "I just want to
  fix this one URL" path, no mode ceremony.
- **Broken-widget honesty (#8):** when widget config fails validation, stop
  silently downgrading. Render the tile with a small warning badge; in edit
  mode the badge opens the edit dialog focused on the widget section with the
  Zod error shown.

### 6.5 Bookmarks (fixes U5)

Adopt the two-tier model, with Homarr's container insight and Glance's accents:
**a bookmark group is one grid tile** — it participates in groups, sizing, and
drag like any other tile, so 20 links cost one `tall` tile, not 20 cells.

```yaml
bookmarks:
  - name: Dev
    accent: "#7aa2f7"        # Glance-style group accent (header + link markers)
    style: list              # list | icon-grid | compact
    links:
      - name: GitHub
        url: https://github.com
        icon: sh-github      # optional; falls back to favicon, then abbr
      - name: Grafana docs
        url: https://grafana.com/docs
        abbr: GD             # Homepage-style 2-letter fallback
        description: Panels & alerting reference   # optional, list style only
placement:                   # optional; defaults to a "Bookmarks" group at the end
  group: Infrastructure
  size: tall
```

- **Styles:** `list` (icon + name rows, accent-colored marker — the Glance
  look), `icon-grid` (favicon grid for many links in small space),
  `compact` (text-only two-column). Style is switchable from the tile kebab.
- Rendered visibly *lighter* than service tiles: smaller type, no status dots.
  A per-link `description` is **optional** and rendered only in `list` style
  as a muted second line; `icon-grid` and `compact` ignore it. Bookmarks are
  links, not apps.
- Edit mode: "+ Add link" affordance inside the tile; links reorder by drag
  within the tile; a link can be **promoted to a service** ("make this a tile")
  and a link-only service **demoted to a bookmark** — cheap migration between
  tiers is what makes the two-tier model livable.
- Deliberately **not** a separate page band (Homepage's fixed bookmark strip):
  as a grid citizen it can sit next to related services (e.g. a "Docs" bookmark
  tile inside the Media group).

### 6.6 Visual polish (fixes U1, #13, #14, #10)

Cheap, high-impact items that make the size system land:

- **Background + glass:** `appearance.background: {image|gradient, blur,
  brightness, opacity}` + `appearance.card_blur` — the Homepage frosted-glass
  recipe. With CSS variables already driving theming this is mostly CSS.
- **Icon search (#13, roadmap P1 pulled forward):** shorthand prefixes resolved
  at render (`sh-plex` → selfh.st, `di-sonarr` → dashboard-icons, `mdi-…`) + a
  searchable icon picker in ServiceForm. This is the single biggest "my
  dashboard looks good now" lever for real users; widget presets should ship
  default icons via the same mechanism.
- **Status dots grow up (#10):** hover tooltip with response time + HTTP status;
  optional `statusStyle: dot | badge`. Server-side: one shared ping scheduler
  with a short cache so N browser tabs don't multiply probes; client polls a
  single `/api/status` snapshot instead of per-service `/api/ping`.
- **Micro-interactions:** tile hover lift (2px translate + shadow token),
  group collapse animation, skeleton shimmer for widget loading. All tokenized
  in `globals.css` so themes keep working.

### 6.7 Empty states & onboarding (#7, #11)

- Zero services → a centered welcome card: "Add your first service" (opens the
  add picker) + "Import settings.yaml" pointer for file-first users.
- An empty group in edit mode shows a ghost "＋" tile.
- First entry into edit mode gets a 3-hint coach-mark pass (drag, kebab, save
  bar), dismissed forever after.

---

## 7. Architecture

### 7.1 Schema changes (`src/config/schema.ts`)

All additive; `schema_version` stays 1 until `position` is removed.

```yaml
schema_version: 1
appearance:
  theme: dark
  background: { image: /bg.jpg, blur: 12, brightness: 0.7 }   # new, optional
  card_blur: 8                                                # new, optional
layout:
  columns: 4
  row_height: 120            # becomes the base row unit for spans
  ungrouped: last            # NEW — first | last (default last)
groups:                      # NEW — ordered, optional (fallback = today's behavior)
  - name: Media
    collapsed: false
    columns: 4
services:
  - name: Plex
    url: https://plex.local
    icon: sh-plex            # shorthand resolution added
    group: Media
    size: large              # NEW — normal|wide|tall|large (default normal)
    widget: { type: plex, ... }
  # position: {...}          # DEPRECATED — migrated to size+order, validator warns
bookmarks:                   # NEW — see §6.5
  - name: Dev
    accent: "#7aa2f7"
    style: list
    placement: { group: Infrastructure, size: tall }
    links: [ ... ]
```

Zod additions: `GroupSchema`, `SizeEnum`, `BookmarkGroupSchema`, `BookmarkLinkSchema`,
`BackgroundSchema`; `WidgetDefinition` gains `preferredSize?/minSize?`.
`superRefine` rules: unique group names, unique bookmark-group names,
`services[].group` may reference undeclared groups (auto-append), size ≥ widget
`minSize` (warn, don't reject).

### 7.2 Frontend architecture

- **Drag & drop: `@dnd-kit` (core + sortable).** Rationale over alternatives:
  - *gridstack / react-grid-layout* solve absolute x/y grids — the model we're
    deliberately rejecting (principle 3); they'd force coordinate persistence.
  - *dnd-kit* is headless, React-19-compatible, accessible (keyboard sorting
    built in — which also becomes part of the touch/mobile answer), tree-shakes
    small, and models exactly what we need: sortable lists (tiles within a
    group, groups themselves) with cross-container moves.
  - Rendering stays **pure CSS Grid** — dnd-kit only reorders the array; spans
    remain CSS classes per size preset. `grid-auto-flow: dense` handles packing.
- **Edit-mode state:** a client `EditModeProvider` (React context + reducer)
  mounted in the protected layout. State = `{ draft: KokpitConfig, baseRevision,
  dirtyOps[] }`. View mode renders server-component output exactly as today;
  entering edit mode hydrates the draft from a `GET /api/settings` snapshot and
  swaps the grid to a client-rendered `EditableServiceGrid` bound to the draft.
  Exit-with-save → single `PATCH`; exit-with-discard → drop draft, back to RSC
  output. This keeps the fast server-rendered read path untouched and confines
  all interactivity cost to edit mode.
- **Component changes:**
  - `ServiceGrid` — consumes `groups:` ordering, renders size-span classes,
    bookmark tiles, collapse chevrons. Stays a server component.
  - `EditableServiceGrid` (new, client) — dnd-kit sortable contexts (one per
    group + one for group order), ghost/add tiles, edit bar.
  - `ServiceTile` — gains `size` variants (CSS classes `--normal … --large`),
    kebab slot, warning badge; keeps `.service-tile` selector family (e2e
    dependency).
  - `BookmarkTile` (new) — three styles, accent variable.
  - `TileKebab`, `SizePicker`, `AddTilePicker`, `EditBar`, `IconPicker` (new,
    all client, all only mounted in edit mode except the hover pencil).
- **CSS:** size presets as modifier classes over the existing grid, spanning
  whole rows/columns (`grid-auto-rows: var(--row-height)` stays as-is). Mobile
  media queries collapse every preset to full-width `normal` (preserving the
  no-horizontal-overflow e2e invariant).

### 7.3 Persistence & API

- Reuse `PATCH /api/settings` for the atomic save — the payload is the full
  draft of the changed top-level keys (`services`, `groups`, `bookmarks`,
  `appearance`); `writeConfig()` already does comment-preserving key-wise
  writes. Add a `revision` (content hash) returned by `GET /api/settings` and
  checked on `PATCH` → `409` on mismatch powers the conflict banner (§6.3).
- New `GET /api/status` (batched ping snapshot with server-side cache/scheduler)
  replaces per-tile `/api/ping` polling; keep `/api/ping` for one-off tests.
- New `GET /api/icons/search?q=` proxying the bundled/cached dashboard-icons +
  selfh.st indexes (roadmap P1 item, pulled forward because the picker needs it).
- No database. No new persistence layer. Export/backup stays "copy the YAML."

### 7.4 Explicitly rejected alternatives

- **Free-form gridstack canvas (Homarr):** best-in-class mouse feel, but forces
  absolute coordinates per breakpoint into YAML (unreadable, un-hand-editable),
  has a documented broken touch story, and drags in a jQuery-era dependency.
  Flow + spans keeps the file human, and Dashy proves presets deliver most of
  the visual variety.
- **DB-backed layout with YAML export:** cleanest for concurrent edits, but
  surrenders kokpit's core identity (single-file, git-diffable, watcher-driven)
  and Homarr shows the community reads DB-only as a drawback.
- **Homepage-style separate bookmark band:** simpler, but bookmark groups as
  grid tiles compose better with groups/sizes and avoid a second layout system.

---

## 8. Phasing

Each phase ships independently and leaves the dashboard fully working.

- **Phase A — Layout foundation (schema + rendering, no DnD):**
  `groups:` entity + ordering/collapse, `size` presets + smart defaults +
  widget size hints, bookmark tiles (all three styles), `position` migration.
  Ordering editable via settings panel (groups/services get up/down controls)
  so the schema is fully usable before edit mode lands.
- **Phase B — Edit mode:** EditModeProvider, dnd-kit reorder (tiles, cross-group,
  groups), kebab menus reusing ServiceForm, size picker, add-tile picker, edit
  bar with staged save + revision conflict check, touch fallback controls,
  empty states + coach marks.
- **Phase C — Polish pass:** background + card blur, icon shorthands + search
  picker, status tooltip + batched `/api/status`, hover/collapse/skeleton
  micro-interactions, broken-widget badge.

Phase A alone fixes U1/U2/U5 and half of U3; B completes U3/U4; C is the
"looks genuinely good" layer. Roadmap alignment: this subsumes Phase 2's
"Bookmarks & groups" and Phase 3's "Drag-and-drop layout editor" P0, pulls
forward the P1 icon library, and stays compatible with future multi-page tabs
(pages would become a level above `groups:`).

## 9. Testing impact & risks

- **Visual e2e:** all `visual.spec.ts` dashboard snapshots regenerate per phase
  (4 themes + widget-error + custom-css); add snapshots for size presets,
  bookmark styles, and edit-mode chrome. Keep `.service-tile`, `.status-dot`,
  `__icon`/`__letter-fallback` selectors stable.
- **Mobile e2e:** the no-horizontal-overflow sweep must pass with spans
  collapsed; add a touch-editing spec (kebab reorder buttons).
- **New unit surface:** group-ordering resolution (declared + auto-appended),
  size/`position` migration, revision conflict on PATCH, bookmark schema.
- **Risks:** (1) dnd-kit + React 19 + RSC boundary — mitigated by confining DnD
  to the client-only edit grid; (2) YAML round-trip fidelity under array
  reordering — `writeConfig` uses key-wise `setIn`, array rewrites may drop
  intra-array comments; needs a focused test and possibly item-identity-aware
  writing.

## 10. Resolved decisions (2026-07-20, project owner)

1. **Ungrouped placement:** user-configurable via `layout.ungrouped:
   first | last`, default `last` (today's behavior).
2. **Half-height `compact` preset:** dropped entirely. Link density comes from
   bookmark-group tiles; the grid stays on whole-row units.
3. **Bookmark link descriptions:** allowed as an optional per-link
   `description`, rendered only in `list` style as a muted second line.
4. **Group collapse state:** per-device (localStorage); the YAML `collapsed:`
   key only sets the default.
