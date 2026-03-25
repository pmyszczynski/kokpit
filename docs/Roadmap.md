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

- [ ] `P0` **Widget system architecture**
  - Plugin-like widget API: each widget has a config schema, async data fetcher, and render component
  - Widgets declared in `settings.yaml` under `widgets:`
  - Error states, loading states, and refresh intervals per widget

- [ ] `P0` **Tier-1 self-hosted integrations**
  - Media: Plex
  - *arr stack: Sonarr, Radarr, Prowlarr
  - Downloads: qBittorrent, SABnzbd
  - Media requests: Seerr (Overseerr / Jellyseerr)
  - Photos: Immich
  - Infra: Unraid, Netdata
  - Each shows relevant live stats on its tile (not just a link)

- [ ] `P0` **System stats widget**
  - CPU, RAM, disk usage, network I/O
  - Docker container count / status overview
  - Data via local agent, `/proc`, or optional SSH target

- [ ] `P1` **Useful API widgets**
  - Weather: Open-Meteo (no API key) + OpenWeatherMap (API key)
  - RSS feed reader widget
  - Calendar widget (CalDAV, Google Calendar via API key)
  - Search bar widget (configurable search engine)

- [ ] `P1` **Docker auto-discovery**
  - Detect running containers via Docker socket
  - Auto-populate service tiles from container labels
  - Label schema: `dashboard.name`, `dashboard.url`, `dashboard.icon`, `dashboard.group`

- [ ] `P2` **Bookmarks & groups**
  - Bookmark links separate from service tiles
  - Grouped into named sections/tabs
  - Drag-to-reorder within groups

---

## Phase 3 — Personalization

> Goal: Let users make the dashboard their own without touching code.

- [ ] `P0` **Theme engine**
  - Built-in themes: dark, light, OLED, high-contrast (minimum)
  - Theme picker in UI settings
  - All colors as CSS variables, overridable via `appearance.customCss`
  - Theme schema documented so community themes are possible

- [ ] `P0` **Drag-and-drop layout editor**
  - Visual grid editor: move, resize, delete tiles and widgets
  - Layout saved back to `settings.yaml` on save
  - Lock layout option (prevents accidental changes)

- [ ] `P1` **Icon library & custom icons**
  - Bundle Walkxcode / Dashboard Icons set (7000+ homelab icons)
  - Simple Icons fallback
  - User icon upload per service tile
  - Icon search in the service editor

- [ ] `P1` **Background customization**
  - Options: solid color, gradient, custom image URL, local upload
  - Blur-behind effect toggle
  - Opacity overlay (configurable in UI and YAML)

- [ ] `P2` **Multiple dashboard pages / tabs**
  - Named pages (e.g. Home, Media, Monitoring, Network)
  - Tab or sidebar navigation between pages
  - Per-page layout stored in `settings.yaml`

- [ ] `P2` **Mobile-responsive layout**
  - Responsive breakpoints for tablet and mobile
  - Optional separate mobile layout config
  - PWA manifest for home screen installation

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

- [ ] Workspace view (multiple services open in iframes side by side)
- [ ] Notification center (pull alerts from integrated services)
- [ ] CLI tool for config management (`dashboard config set`, `dashboard backup`)
- [ ] Kubernetes deployment manifests + Helm chart
- [ ] End-to-end encrypted cloud config sync (optional, self-hostable sync server)
- [ ] Localization / i18n support
- [ ] Android/iOS companion app (read-only dashboard view)