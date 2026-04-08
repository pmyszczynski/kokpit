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
- [x] Plex integration
- [x] Sonarr integration
- [x] Radarr integration
- [x] qBittorrent integration
- [x] SABnzbd integration
- [ ] Prowlarr integration
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

#### Quick start with pre-built image

If you just want to run Kokpit, use the pre-built image from GitHub Container Registry (available from v0.2.0 onwards):

```bash
mkdir kokpit && cd kokpit
docker run -d \
  --name kokpit \
  -p 3000:3000 \
  -v ./data:/data \
  -e KOKPIT_SESSION_SECRET=change-this-to-a-random-32-char-secret \
  -e KOKPIT_DB_PATH=/data/users.db \
  ghcr.io/pmyszczynski/kokpit:latest
```

Kokpit will be available at `http://localhost:3000`. On first run, a setup wizard will prompt you to create the initial admin account.

To use a specific version:
```bash
docker run ... ghcr.io/pmyszczynski/kokpit:0.2.0
```

#### Building from source

If you want to build the image yourself or need the latest unreleased features:

1. Clone the repo:

```bash
git clone https://github.com/pmyszczynski/kokpit.git
cd kokpit
```

2. Set a strong session secret in `docker-compose.yml` (replace the placeholder value for `KOKPIT_SESSION_SECRET`).

3. Start the production container:

```bash
docker compose up kokpit --build
```

**For information about Docker image releases, versioning, and publishing to GHCR, see [`docs/DOCKER_RELEASES.md`](docs/DOCKER_RELEASES.md).**

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

Two widgets are available for Sonarr: a calendar showing upcoming episodes and a download queue monitor.

**Prerequisites:** An API key from Sonarr → Settings → General → Security.

#### `sonarr-calendar`

Shows upcoming episode air dates for the configured number of days ahead.

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
| `api_key` | Yes | API key from Sonarr → Settings → General |
| `days` | No | Days ahead to show (1–30, default: 7) |

#### `sonarr-queue`

Shows active downloads with progress bars, status, and ETA.

```yaml
services:
  - name: Sonarr
    url: http://192.168.1.10:8989
    icon: sonarr
    widget:
      type: sonarr-queue
      config:
        url: http://192.168.1.10:8989
        api_key: YOUR_API_KEY
```

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | Base URL of your Sonarr instance |
| `api_key` | Yes | API key from Sonarr → Settings → General |

---

### Radarr

Two widgets are available for Radarr: a stats overview and a download queue monitor.

**Prerequisites:** An API key from Radarr → Settings → General → Security.

#### `radarr-stats`

Displays a six-stat grid showing the state of your movie library.

```yaml
services:
  - name: Radarr
    url: http://192.168.1.10:7878
    icon: radarr
    widget:
      type: radarr-stats
      config:
        url: http://192.168.1.10:7878
        api_key: YOUR_API_KEY
```

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | Base URL of your Radarr instance |
| `api_key` | Yes | API key from Radarr → Settings → General |

**Displayed stats:**

| Stat | Description |
|------|-------------|
| Missing | Monitored movies without a file that are already released |
| Upcoming | Movies in "announced" or "in cinemas" status |
| Wanted | All monitored movies without a file |
| Queued | Total items currently in the download queue |
| Available | Movies with a downloaded file |
| Total | All movies tracked in Radarr |

#### `radarr-queue`

Shows active movie downloads with progress bars, status, and ETA.

```yaml
services:
  - name: Radarr
    url: http://192.168.1.10:7878
    icon: radarr
    widget:
      type: radarr-queue
      config:
        url: http://192.168.1.10:7878
        api_key: YOUR_API_KEY
```

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | Base URL of your Radarr instance |
| `api_key` | Yes | API key from Radarr → Settings → General |

---

## Contributing

Contributions are welcome. Please open an issue first to discuss significant changes before sending a pull request.

- **Bug reports & feature requests:** open a GitHub issue
- **Pull requests:** branch from `main`, keep changes focused, and make sure `npm run lint`, `npm run type-check`, and `npm test` all pass before submitting
- Follow the existing code style — ESLint and TypeScript strict mode are enforced in CI

## License

MIT — see [LICENSE](LICENSE) for details.
