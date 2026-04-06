# kokpit

A self-hosted homelab dashboard built with Next.js. Kokpit gives you a single place to access all your self-hosted services, with live status indicators, system widgets, and a fully YAML-driven configuration — no database config required.

## What it does

Kokpit is a personal dashboard for homelab and self-hosted setups. You define your services, widgets, and layout in a single `settings.yaml` file, and Kokpit renders a clean, themeable dashboard accessible from any browser.

**Phase 1 — Foundation**
- [x] Project scaffold & tech stack (Next.js, Docker, CI)
- [x] YAML config engine with hot-reload
- [x] Authentication (username/password, session cookies)
- [ ] Optional TOTP 2FA
- [x] Base UI shell (navbar, grid canvas, dark/light/OLED/high-contrast themes)
- [x] Service tiles with favicon fallback and status ping indicator
- [x] In-app settings panel (appearance, layout, auth, services CRUD)

**Phase 2 — Integrations & Widgets**
- [x] Widget system architecture
- [x] Plex integration (streams, transcodes, library stats)
- [x] Sonarr integration (calendar, queue)
- [ ] Radarr integration
- [x] Prowlarr integration (indexer health, grab stats)
- [x] qBittorrent integration (stats, torrent list)
- [x] SABnzbd integration (queue stats)
- [ ] Overseerr / Jellyseerr integration
- [ ] Immich integration
- [ ] Unraid, Netdata integrations
- [ ] System stats widget (CPU, RAM, disk, Docker)
- [ ] Useful API widgets (weather, RSS, calendar, search bar)
- [ ] Docker auto-discovery via socket + container labels

**Phase 3 — Personalization**
- [ ] Theme engine with community theme support
- [ ] Drag-and-drop layout editor
- [ ] Icon library (7000+ homelab icons) & custom icon upload
- [ ] Background customization (image, gradient, blur)
- [ ] Multiple dashboard pages / tabs
- [ ] Mobile-responsive layout & PWA

**Phase 4 — Polish & Growth**
- [ ] Config import / export / backup
- [ ] Multi-user & roles (admin, viewer)
- [ ] SSO / OAuth (Keycloak, Authelia, Authentik, generic OIDC)
- [ ] Extended integrations (Home Assistant, Nextcloud, Immich, Vaultwarden, Grafana, …)
- [ ] Keyboard shortcuts & ⌘K global search
- [ ] Plugin / community widget API

See [`docs/Roadmap.md`](docs/Roadmap.md) for full details and priority levels.

## Installation

### Docker (recommended)

1. Clone the repo and copy the example config:

```bash
git clone https://github.com/pmyszczynski/kokpit.git
cd kokpit
```

2. Set a strong session secret in `docker-compose.yml` (replace the placeholder value for `KOKPIT_SESSION_SECRET`).

3. Start the production container:

```bash
docker compose up kokpit --build
```

Kokpit will be available at `http://localhost:3000`. On first run, a setup wizard will prompt you to create the initial admin account.

### Local development

**Prerequisites:** Node.js 20+

```bash
npm install
npm run dev
```

The dev server starts at `http://localhost:3000` with hot reload enabled.

**Or with Docker:**

```bash
docker compose up kokpit-dev
```

## Usage

All configuration lives in `settings.yaml` at the project root. The in-app settings panel (accessible via the ⚙ icon in the navbar) reads from and writes back to this file — changes take effect immediately without a restart. You can also edit the YAML directly.

**Add a service tile:**

```yaml
services:
  - name: Jellyfin
    url: http://192.168.1.10:8096
    icon: jellyfin
    description: Media server
    group: Media
```

**Change the theme:**

```yaml
appearance:
  theme: light  # dark | light | oled | high-contrast
```

**Inject custom CSS:**

```yaml
appearance:
  custom_css: |
    :root { --color-accent: #f97316; }
```

**Disable authentication** (for trusted local networks):

```yaml
auth:
  enabled: false
```

Or set the environment variable `KOKPIT_AUTH_DISABLED=true`.

## Widgets

Widgets display live data from your self-hosted services directly on a service tile. Each widget polls its service on a configurable interval and renders the data you choose.

**Two ways to configure a widget:**

- **In-app:** open Settings → Services → edit a service → expand the Widget section, pick a type, fill in the fields, and save.
- **YAML:** add a `widget` block to the service entry in `settings.yaml`.

The general YAML shape is:

```yaml
services:
  - name: My Service
    url: http://192.168.1.10:PORT
    widget:
      type: <widget-id>
      config:
        # widget-specific fields (see each widget below)
      refresh_interval_ms: 30000  # optional, minimum 5000
```

Credentials in `widget.config` are read server-side only and are never sent to the browser.

---

### Plex

Displays live playback and library statistics from a Plex Media Server.

**Prerequisites:** You need your Plex authentication token (`X-Plex-Token`). Find it by signing in to Plex Web, opening any media item's "Get Info" page, clicking "View XML", and copying the `X-Plex-Token` value from the URL.

**YAML example:**

```yaml
services:
  - name: Plex
    url: http://192.168.1.10:32400
    icon: plex
    widget:
      type: plex
      config:
        url: http://192.168.1.10:32400
        token: YOUR_PLEX_TOKEN
        fields:
          - streams
          - transcodes
          - library_movies
          - library_shows
```

**Config fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | Base URL of your Plex Media Server |
| `token` | Yes | `X-Plex-Token` for authentication |
| `fields` | No | List of stats to display (default: `[streams, transcodes]`) |

**Available display fields:**

| Value | Label | Description |
|-------|-------|-------------|
| `streams` | Streaming | Total active sessions |
| `transcodes` | Transcoding | Sessions currently being transcoded |
| `lan_streams` | LAN | Active sessions on the local network |
| `remote_streams` | Remote | Active sessions over the internet |
| `users` | Users | Number of distinct users currently watching |
| `bandwidth` | Bandwidth | Total streaming bandwidth (shown in Mbps) |
| `library_movies` | Movies | Total movies across all movie libraries |
| `library_shows` | Shows | Total shows across all TV libraries |
| `library_episodes` | Episodes | Total episodes across all TV libraries |
| `library_music` | Music | Total albums across all music libraries |

The widget only contacts `/status/sessions` or `/library/sections` depending on which fields you configure, so it never makes unnecessary requests.

---

### Sonarr

Two widgets are available for Sonarr.

#### `sonarr-calendar` — Upcoming episodes

Shows episodes airing in the next N days, with air date, season/episode code, title, and a downloaded/upcoming badge.

```yaml
services:
  - name: Sonarr
    url: http://192.168.1.10:8989
    icon: sonarr
    widget:
      type: sonarr-calendar
      config:
        url: http://192.168.1.10:8989
        api_key: YOUR_API_KEY
        days: 7
```

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | Base URL of your Sonarr instance |
| `api_key` | Yes | Sonarr API key (Settings → General → Security) |
| `days` | No | Number of days ahead to show (1–30, default: 7) |

#### `sonarr-queue` — Download queue

Shows items currently in the Sonarr download queue with their status and progress.

```yaml
services:
  - name: Sonarr
    url: http://192.168.1.10:8989
    widget:
      type: sonarr-queue
      config:
        url: http://192.168.1.10:8989
        api_key: YOUR_API_KEY
```

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | Base URL of your Sonarr instance |
| `api_key` | Yes | Sonarr API key (Settings → General → Security) |

---

### Prowlarr

Displays indexer health and grab statistics from Prowlarr in a compact 2×2 grid. The **Failing** count turns red when one or more indexers are unhealthy.

**Stats shown:** total indexers, enabled indexers, failing indexers, total grabs.

```yaml
services:
  - name: Prowlarr
    url: http://192.168.1.10:9696
    icon: prowlarr
    widget:
      type: prowlarr-stats
      config:
        url: http://192.168.1.10:9696
        api_key: YOUR_API_KEY
```

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | Base URL of your Prowlarr instance |
| `api_key` | Yes | Prowlarr API key (Settings → General → Security) |

---

### qBittorrent

Two widgets are available for qBittorrent.

#### `qbittorrent-stats` — Transfer stats

Shows download/upload speeds, session totals, and active torrent counts.

```yaml
services:
  - name: qBittorrent
    url: http://192.168.1.10:8080
    icon: qbittorrent
    widget:
      type: qbittorrent-stats
      config:
        url: http://192.168.1.10:8080
        username: admin
        password: YOUR_PASSWORD
```

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | Base URL of your qBittorrent Web UI |
| `username` | Yes | qBittorrent Web UI username |
| `password` | Yes | qBittorrent Web UI password |

#### `qbittorrent-torrents` — Torrent list

Shows a scrollable list of active torrents with name, state, and progress.

```yaml
services:
  - name: qBittorrent
    url: http://192.168.1.10:8080
    widget:
      type: qbittorrent-torrents
      config:
        url: http://192.168.1.10:8080
        username: admin
        password: YOUR_PASSWORD
```

Config fields are identical to `qbittorrent-stats`.

---

### SABnzbd

Shows queue speed, total queue size, and number of queued items.

```yaml
services:
  - name: SABnzbd
    url: http://192.168.1.10:8080
    icon: sabnzbd
    widget:
      type: sabnzbd
      config:
        url: http://192.168.1.10:8080
        apikey: YOUR_API_KEY
```

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | Base URL of your SABnzbd instance |
| `apikey` | Yes | SABnzbd API key (Config → General → API Key) |

---

## Contributing

Contributions are welcome. Please open an issue first to discuss significant changes before sending a pull request.

- **Bug reports & feature requests:** open a GitHub issue
- **Pull requests:** branch from `main`, keep changes focused, and make sure `npm run lint`, `npm run type-check`, and `npm test` all pass before submitting
- Follow the existing code style — ESLint and TypeScript strict mode are enforced in CI

## License

MIT — see [LICENSE](LICENSE) for details.
