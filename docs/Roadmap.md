# ROADMAP.md

Prioritized task list for the self-hosted dashboard project.

**Priority levels:**
- `P0` — Critical / must be done before moving to next phase
- `P1` — High priority, core to the phase goal
- `P2` — Nice to have, can be deferred

Mark tasks with `[x]` as you complete them. Claude Code will read this state.

---

## Phase 1 — Foundation

> Goal: A working, deployable skeleton with auth, YAML config, and a basic UI. Nothing else is built on top until this is solid.

- [X] `P0` **Project scaffold & tech stack**
  - Pick framework (Next.js / SvelteKit), set up monorepo structure
  - Docker & Docker Compose config (dev + prod targets)
  - CI skeleton (lint, type-check, basic test runner)
  - Establish folder structure per `CLAUDE.md`

- [X] `P0` **YAML config engine**
  - Define `settings.yaml` schema: services, widgets, layout, auth, appearance
  - Parser that reads and writes YAML without destroying comments or formatting
  - Schema validator with clear error messages on startup
  - Config watcher — hot-reload on file change in dev

- [X] `P0` **Authentication system**
  - Username/password auth with bcrypt hashing
  - Session tokens (httpOnly cookie, configurable expiry)
  - All routes protected when `auth.enabled: true` in config
  - First-run setup wizard if no users exist

- [x] `P1` **Optional TOTP 2FA**
  - TOTP secret generation and QR code enrollment
  - Verify code on login when 2FA is enabled per user

- [X] `P0` **Base UI shell**
  - App layout: top navbar, optional sidebar, main grid canvas
  - CSS variable system for full theme overridability
  - Default modern dark theme (ship at least 1 light + 1 dark built-in)
  - Custom CSS injection slot (`appearance.customCss` in YAML)

- [x] `P1` **Service tiles (app links)**
  - Clickable tiles: icon, label, URL, optional description
  - Auto-fetch favicon fallback
  - Per-tile status ping indicator (green/red dot)

- [x] `P1` **In-app settings panel**
  - Visual UI that reads from and writes back to `settings.yaml`
  - Changes reflect instantly (no restart required)
  - Cover: services, appearance, layout, auth settings
  - Service tile configuration (add, edit, remove tiles in-app)

---

## Phase 2 — Integrations & Widgets

> Goal: Make the dashboard actually useful day-to-day by showing live data from self-hosted services.

- [x] `P0` **Widget system architecture**
  - Plugin-like widget API: each widget has a config schema, async data fetcher, and render component
  - Widgets declared in `settings.yaml` under `widgets:`
  - Error states, loading states, and refresh intervals per widget

- [x] `P0` **Plex integration** — live stats on tile (active streams, transcodes)
- [x] `P0` **Sonarr integration** — two widgets: calendar (upcoming episodes), queue (queue status)
- [x] `P0` **Radarr integration** — two widgets: stats (missing, upcoming, wanted, queued, all available), queue (queue status)
- [x] `P0` **Prowlarr integration** — stats widget (indexer health, grab stats)
- [x] `P0` **qBittorrent integration** — two widgets: stats (active torrents, speed, ratio), torrents (torrent list)
- [x] `P0` **SABnzbd integration** — stats widget (queue, speed, disk usage)
- [x] `P0` **Overseerr / Jellyseerr integration** — two widgets: stats (pending requests count), requests history
- [x] `P0` **Immich integration** — stats widget (photo/video count, storage usage)
- [x] `P0` **Unraid integration** — stats widget (array status, disk health, parity)
- [x] `P0` **Netdata integration** — live system metrics via Netdata API (7 composable widgets: CPU, RAM, Network, Disk I/O, Disk Space, Load Average, Sensor; shared bulk fetch with caching)
- [ ] `P0` **Tdarr integration** — stats widget (queue, speed, disk usage)
- [x] `P0` **Tile type picker in service editor (UI only)**
  - When adding/editing a tile, user selects a known service type (e.g. Plex, qBittorrent, Radarr) instead of configuring widget type separately
  - Selecting a tile type pre-fills the default icon URL and name — both remain editable
  - Tile type also pre-selects the matching widget, eliminating the separate widget dropdown for known services
  - YAML schema unchanged — tile type is purely a UI concern resolved at save time

- [ ] `P0` **System stats widget**
  - CPU, RAM, disk usage, network I/O
  - Docker container count / status overview
  - Data via local agent, `/proc`, or optional SSH target

- [ ] `P1` **Useful API widgets**
  - Weather: Open-Meteo (no API key) + OpenWeatherMap (API key)
  - RSS feed reader widget
  - Calendar widget (CalDAV, Google Calendar via API key)
  - Search bar widget (configurable search engine)

- [x] `P1` **Docker widget** *(re-scoped from "Docker auto-discovery")*
  - Widget listing active (running, paused, restarting) containers via the Docker socket (state, name, image, uptime) with a running/total summary
  - Read-only Docker Engine API client over the unix socket; socket path configurable per widget or via `KOKPIT_DOCKER_SOCKET`
  - Deferred to backlog: label-based tile auto-discovery (auto-populate service tiles from container labels)

- [x] `P2` **Bookmarks & groups**
  - [x] Bookmark links separate from service tiles
  - [x] Grouped into named sections/tabs
  - [x] Drag-to-reorder within groups — shipped with dashboard edit mode (Phase 3 `P0`, UX redesign Phase B)

---

## Phase 3 — Personalization

> Goal: Let users make the dashboard their own without touching code.

- [ ] `P0` **Theme engine**
  - [x] Built-in themes: dark, light, OLED, high-contrast (minimum)
  - [x] Theme picker in UI settings
  - [x] All colors as CSS variables, overridable via `appearance.custom_css`
  - [ ] Theme schema documented so community themes are possible

- [x] `P0` **Drag-and-drop layout editor** *(UX redesign Phase B — see `docs/plans/2026-07-20-dashboard-ux-redesign.md` §6.3–6.4)*
  - [x] Non-drag foundation: tile size presets (normal/wide/tall/large) and group/service/bookmark ordering via settings-panel up/down controls *(shipped v0.5.0)*
  - [x] Edit mode: navbar pencil toggle + `Mod+E`, staged changes, atomic save/discard, revision conflict check against external YAML edits (409 + reload banner)
  - [x] Drag-to-reorder tiles within and across groups, and drag group headers to reorder declared groups (dnd-kit)
  - [x] Per-tile kebab menu: edit (reuses ServiceForm), size picker, duplicate, remove; "+ Add" picker for blank services/widget presets/bookmark groups; group-header kebab for rename/columns/delete/declare
  - [x] Touch & keyboard support: pointer sensor with 8px activation distance (taps/scroll don't start a drag) covers touch; full keyboard drag (focus handle, Space to pick up, arrows to move, Space to drop)
  - [x] Layout saved back to `settings.yaml` on save; view mode stays read-only and unchanged outside edit mode (prevents accidental changes)

- [x] `P1` **Icon library & custom icons** *(UX redesign Phase C — shipped v0.7.0)*
  - [x] Icon shorthand prefixes resolved at render (`sh-` selfh.st, `di-` dashboard-icons, `mdi-` Material Design) + `/api/icons/search` — resolved from the jsDelivr CDN layer (with cache + SSRF guard), not a bundled set
  - [x] Simple Icons included as a search source (alongside dashboard-icons + selfh.st)
  - [x] User icon upload per tile (PNG/JPG/WebP/SVG ≤ 2 MB, SVG sanitized, stored in the persisted `data/uploads/` volume)
  - [x] Icon search + upload in the service editor
  - [ ] *Deferred:* offline/air-gapped bundling of the full icon set (CDN resolution chosen instead)

- [x] `P1` **Background customization** *(UX redesign Phase C — shipped v0.7.0)*
  - [x] Options: solid color, gradient, custom image URL, local upload (raster ≤ 8 MB)
  - [x] Blur-behind effect + opt-in frosted-glass card blur (`appearance.card_blur`; cards stay opaque unless set)
  - [x] Brightness + opacity overlay (configurable in UI and YAML)

- [ ] `P1` **Status indicator upgrades** *(part of UX redesign Phase C)*
  - Hover tooltip with response time + HTTP status; optional `statusStyle: dot | badge`
  - Batched `GET /api/status` with a shared server-side ping scheduler/cache, replacing per-tile `/api/ping` polling from every open tab

- [ ] `P2` **Empty states & onboarding** *(part of UX redesign Phase C)*
  - Welcome card with "Add your first service" when the dashboard is empty (today: blank page)
  - Ghost "+" tile in empty groups while editing; first-edit coach marks

- [ ] `P2` **Broken-widget feedback** *(part of UX redesign Phase C)*
  - Warning badge on tiles whose widget config fails validation, instead of today's silent downgrade to a plain link
  - Badge links to the edit dialog with the validation error shown

- [ ] `P2` **Multiple dashboard pages / tabs**
  - Named pages (e.g. Home, Media, Monitoring, Network)
  - Tab or sidebar navigation between pages
  - Per-page layout stored in `settings.yaml`

- [ ] `P2` **Mobile-responsive layout**
  - [x] Responsive breakpoints for tablet and mobile (per-breakpoint column/row-height overrides; size presets collapse gracefully at 768px/480px since v0.5.0)
  - [ ] Optional separate mobile layout config — *partially done: tablet/mobile can override columns and row height; a full per-device layout (own order/sizes) remains open*
  - [ ] PWA manifest for home screen installation

---

## Phase 4 — Polish & Growth

> Goal: Production-ready feature set. Multi-user, extended integrations, power-user UX.

- [ ] `P0` **Config import / export / backup**
  - One-click `settings.yaml` export from UI
  - Import to restore or migrate between instances
  - Optional scheduled backup to a local path (configurable in YAML)

- [ ] `P0` **Multi-user & roles**
  - Admin role: full access, can edit layout and config
  - Viewer role: read-only, can see dashboard but not edit
  - Per-user layout overrides (viewer sees default, can optionally customize own view)
  - User invite flow via generated token

- [ ] `P1` **SSO / OAuth support**
  - Keycloak, Authelia, Authentik integration
  - Generic OIDC provider support
  - Configurable in `auth:` section of YAML

- [ ] `P1` **Extended integrations (Tier 2)**
  - Home automation: Home Assistant
  - Files / cloud: Nextcloud
  - Security: Vaultwarden, CrowdSec
  - Analytics: Tautulli, Grafana embed widget
  - Finance: Actual Budget, Firefly III

- [ ] `P2` **Keyboard shortcuts & global search**
  - ⌘K / Ctrl+K launcher: search across all services and bookmarks
  - Configurable keyboard shortcuts for top services
  - Search navigates to service or opens in configured mode (new tab, same tab, modal)

- [ ] `P2` **Plugin / community widget API**
  - Documented public widget API
  - Community repo or registry for third-party widget packs
  - Widget hot-loading without app restart

---

## Deferred / Backlog

> Ideas captured but not yet prioritized into a phase.

- [ ] Docker label-based auto-discovery (auto-populate service tiles from `dashboard.*` container labels)
- [ ] Workspace view (multiple services open in iframes side by side)
- [ ] Notification center (pull alerts from integrated services)
- [ ] CLI tool for config management (`dashboard config set`, `dashboard backup`)
- [ ] Kubernetes deployment manifests + Helm chart
- [ ] End-to-end encrypted cloud config sync (optional, self-hostable sync server)
- [ ] Localization / i18n support
- [ ] Android/iOS companion app (read-only dashboard view)