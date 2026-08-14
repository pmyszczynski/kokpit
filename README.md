# kokpit

A self-hosted homelab dashboard built with Next.js. Kokpit gives you a single place to access all your self-hosted services, with live status indicators, system widgets, and a fully YAML-driven configuration — no database config required.

## What it does

Kokpit is a personal dashboard for homelab and self-hosted setups. You define your services, widgets, and layout in a single `settings.yaml` file, and Kokpit renders a clean, themeable dashboard accessible from any browser.

See `[docs/Roadmap.md](docs/Roadmap.md)` for full details on Roadmap and priority levels.

## Installation

### Docker (recommended)

#### Quick start with pre-built image

If you just want to run Kokpit, use the pre-built image from GitHub Container Registry (available from v0.2.0 onwards).

**1. Create a working directory:**

```bash
mkdir kokpit && cd kokpit
```

**2. Create a `docker-compose.yml`:**

```yaml
services:
  kokpit:
    image: ghcr.io/pmyszczynski/kokpit:latest
    container_name: kokpit
    ports:
      - "3000:3000"          # Change the left side to expose on a different host port
    environment:
      # Required — must be a random string of at least 32 characters.
      # Used to sign session tokens. Changing this invalidates all active sessions.
      # Generate one with: openssl rand -hex 32
      KOKPIT_SESSION_SECRET: change-this-to-a-random-32-char-secret

      # Optional — set to "true" to skip authentication entirely.
      # Only use this on a trusted local network behind a firewall.
      # KOKPIT_AUTH_DISABLED: "false"

      # Optional — set to "true" to let the service editor's icon-detect
      # feature fetch icons from LAN/loopback addresses. Off by default:
      # icon detection only reaches ordinary public hosts, since anyone who
      # can trigger it could otherwise probe your private network. Cloud
      # metadata addresses stay blocked either way.
      # KOKPIT_ICON_DETECT_ALLOW_PRIVATE_NETWORKS: "false"
    volumes:
      # All persistent state (settings.yaml + SQLite DB) lives here.
      # The image defaults both paths to /data — no extra config needed.
      - ./data:/data
    restart: unless-stopped
    healthcheck:
      # Probe 127.0.0.1 rather than "localhost" — inside the container
      # "localhost" also resolves to ::1, which nothing listens on.
      test: ["CMD-SHELL", "wget -qO- \"http://127.0.0.1:$${PORT:-3000}/api/health\" || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
```

**3. Start it:**

```bash
docker compose up -d
```

Kokpit will be available at `http://localhost:3000`. On first run, a setup wizard will prompt you to create the initial admin account.

To pin to a specific version instead of `latest`:

```yaml
    image: ghcr.io/pmyszczynski/kokpit:0.2.0
```

#### Building from source

If you want to build the image yourself or need the latest unreleased features:

1. Clone the repo:

```bash
git clone https://github.com/pmyszczynski/kokpit.git
cd kokpit
```

1. Set a strong session secret in `docker-compose.yml` (replace the placeholder value for `KOKPIT_SESSION_SECRET`).
2. Start the production container:

```bash
docker compose up kokpit --build
```

**For information about Docker image releases, versioning, and publishing to GHCR, see `[docs/DOCKER_RELEASES.md](docs/DOCKER_RELEASES.md)`.**

### Local development

**Prerequisites:** Node.js 22.19.0+

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

All configuration lives in `settings.yaml` at the project root. The in-app settings panel (accessible via the ⚙ icon in the navbar, with Services, Groups, and Bookmarks tabs) reads from and writes back to this file — changes take effect immediately without a restart. You can also edit the YAML directly.

On first load after the schema-v2 upgrade, Kokpit detects the legacy service shape even when the file has no `schema_version`, migrates it, and keeps the exact original as `settings.yaml.pre-v2.bak`. Configuration writes fail closed under an inter-process lock. If Kokpit is forcibly terminated and a later startup reports a settings-lock timeout, first verify that no Kokpit process or container is using the config volume, then remove only the `settings.yaml.lock` directory; an interrupted `settings.yaml.displaced` transaction is recovered automatically on the next start.

**Add a service tile:**

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000001
    name: Jellyfin
    launch_url: http://192.168.1.10:8096
    icon: jellyfin
    description: Media server
service_tiles:
  - id: 20000000-0000-4000-8000-000000000001
    service_id: 10000000-0000-4000-8000-000000000001
    group: Media
```

**Set a tile footprint:**

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000002
    name: Plex
    launch_url: http://192.168.1.10:32400
service_tiles:
  - id: 20000000-0000-4000-8000-000000000002
    service_id: 10000000-0000-4000-8000-000000000002
    footprint:
      columnSpan: 6
      rowSpan: 4
```

The dashboard uses non-configurable 108×60px units with an 8px gap and automatically exposes 3, 6, 9, 12, or 15 columns as the viewport grows. A footprint is the exact number of those units a tile occupies. Plain cards default to 3×1 (or 3×2 when they have a description); widgets use their preferred/minimum canvas. The editor's `normal`, `wide`, `tall`, and `large` choices map widget canvases to 3×2, 6×2, 3×4, and 6×4. Legacy `size`, `position`, `layout.columns`, `layout.row_height`, and per-group `columns` values are migrated to fixed footprints or removed on load.

**Group services into ordered sections:**

```yaml
groups:
  - name: Media
    collapsed: false  # default expanded; live state is saved per-browser
  - name: Downloads

services:
  - id: 10000000-0000-4000-8000-000000000003
    name: Jellyfin
service_tiles:
  - id: 20000000-0000-4000-8000-000000000003
    service_id: 10000000-0000-4000-8000-000000000003
    group: Media
```

Array order in `groups:` is display order. A group referenced by a service tile but not listed here is auto-appended (today's alphabetical behavior), so this block is optional. Ungrouped tiles render as their own section, placed first or last via `layout.ungrouped: first | last` (default `last`). Groups are collapsible on the dashboard; the `collapsed` key only sets the default — collapse state itself is remembered per device. The Groups tab in the settings panel covers reordering, renaming (cascades to member tiles), declaring, deleting, and setting these options.

**Add a bookmarks tile:**

```yaml
bookmarks:
  - name: Dev
    accent: "#7aa2f7"    # group accent (header + link markers)
    style: list          # list | icon-grid | compact (default: list)
    placement:
      group: Infrastructure  # optional: render inside this group
      size: tall              # optional: tile size preset
    links:
      - name: GitHub
        url: https://github.com
        icon: sh-github        # optional; falls back to favicon, then abbr
      - name: Grafana docs
        url: https://grafana.com/docs
        abbr: GD                # 2-letter fallback when there is no icon
        description: Panels & alerting reference  # shown in list style only
```

A bookmark group renders as a single grid tile holding plain links — useful for links that don't warrant a full service tile. Without `placement`, bookmarks render in an implicit "Bookmarks" section at the end. The Bookmarks tab in the settings panel covers full CRUD, including link ordering.

**Set a tile icon:**

The `icon:` field on a service or bookmark link accepts a full image URL, or a shorthand that resolves to an icon from a public set at render time:

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000004
    name: Sonarr
    icon: di-sonarr        # dashboard-icons
  - id: 10000000-0000-4000-8000-000000000005
    name: GitHub
    icon: sh-github        # selfh.st icons
  - id: 10000000-0000-4000-8000-000000000006
    name: Home
    icon: mdi-home         # Material Design Icons
service_tiles:
  - id: 20000000-0000-4000-8000-000000000004
    service_id: 10000000-0000-4000-8000-000000000004
  - id: 20000000-0000-4000-8000-000000000005
    service_id: 10000000-0000-4000-8000-000000000005
  - id: 20000000-0000-4000-8000-000000000006
    service_id: 10000000-0000-4000-8000-000000000006
```

- `di-<name>` → [dashboard-icons](https://github.com/homarr-labs/dashboard-icons), `sh-<name>` → [selfh.st](https://selfh.st/icons/), `mdi-<name>` → Material Design Icons.
- Anything else (a `http(s)://` URL or an uploaded path) is used as-is. When no icon resolves, tiles fall back to the site favicon, then a letter abbreviation.
- In the service editor, **Browse icons** searches these sets, and **Upload icon** stores a custom image (PNG/JPG/WebP/SVG, up to 2 MB; SVGs are sanitized) in the persisted `data/uploads/` volume.

**Change the theme:**

```yaml
appearance:
  theme: light  # dark | light | oled | high-contrast
```

**Customize the background:**

```yaml
appearance:
  card_blur: 8             # frosted-glass blur (px) on tiles; opaque when unset
  background:
    image: /api/backgrounds/user/abc123.jpg  # uploaded path, or any image URL
    blur: 12               # blur-behind radius (px)
    brightness: 0.7        # 0–1, dims the image
    opacity: 0.4           # 0–1, theme-tinted overlay on top
```

Use `color:` or `gradient:` instead of `image:` for a solid or CSS-gradient background (if more than one is set, `image` wins over `gradient` over `color`). Setting `card_blur` above `0` makes tiles translucent, so the background shows through — otherwise cards stay fully opaque, exactly as before. All of this is also editable from the Appearance tab in the settings panel, including background image upload.

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

## Edit Mode

Click the pencil icon in the navbar (or press `Mod+E` — Cmd+E on macOS, Ctrl+E on Windows/Linux) to edit the dashboard in place. Edit mode follows the same access as `/settings` — any authenticated user, or everyone if `auth.enabled: false`. Outside edit mode, the dashboard is unchanged and read-only, exactly as it renders today.

While editing:

- **Reorder tiles** by dragging them — within a group, or across groups (dropping a tile into another group's grid reassigns it there). Drag a group's header to reorder whole groups. Dragging uses an 8px pointer-activation threshold so taps and scrolling don't start a drag, which is also what makes it work on touch. Full keyboard support too: Tab to a tile's drag handle, press Space to pick it up, arrow keys to move it, Space again to drop.
- **Configure a tile** from its kebab menu: **Edit** opens the same service/bookmark form used elsewhere, **Size** switches between `normal` / `wide` / `tall` / `large` (sizes below a widget's minimum are greyed out), plus **Duplicate** and **Remove**.
- **Add a tile** with the **+ Add** button — a blank service, one of the widget presets, or a bookmark group, dropped into whichever group you opened it from.
- **Manage a group** from its header kebab: rename (cascades to every member service and bookmark, and carries over the collapse state), declare it for ordering, or delete it (members become ungrouped).
- **Save or discard** from the persistent edit bar. It tracks how many top-level sections changed; **Save & exit** writes everything in a single atomic request to `settings.yaml`, **Discard** drops the staged changes and returns to the live dashboard.

**Conflict safety:** edit mode captures the config revision when you enter. If `settings.yaml` changes on disk while you're editing — a hand edit, another tab saving first — Save is rejected instead of silently overwriting, and the edit bar shows a "changed on disk" notice with a **Reload** action to pull the new version before you try again.

## Account Recovery

Kokpit doesn't collect an email address or phone number, so password recovery works differently than most apps.

**Recovery code (self-service).** When you complete the setup wizard, Kokpit shows you a one-time recovery code (`xxxxxxxx-xxxxxxxx-xxxxxxxx-xxxxxxxx`). Save it in a password manager — it's shown exactly once and is the only way to reset your password from the web UI. If you forget your password:

1. Click **Forgot password?** on the login page.
2. Enter your username, recovery code, and a new password.

Redeeming the code resets your password only. If you have 2FA enabled, you'll still need your authenticator app to sign in afterward — a leaked recovery code can't bypass 2FA on its own. The code is single-use; after redeeming it, generate a new one from **Settings → Authentication → Generate new recovery code** (this requires your current password).

**Lost the recovery code too?** If you're locked out entirely — forgotten password, and no recovery code, and (if applicable) no TOTP device — you can reset your password directly from the host or container running Kokpit, the same access level already required to read `data/users.db`:

```bash
# Docker
docker compose exec kokpit npm run reset-password

# Bare metal / local dev
npm run reset-password
```

This walks you through setting a new password, and optionally clearing 2FA and/or the saved recovery code, directly against the database.

## Widgets

Widgets display live data from your self-hosted services directly on a service tile. Each widget polls its service on a configurable interval and renders the data you choose.

**Two ways to configure a widget:**

- **In-app:** open Settings → Services → edit a service → expand the Widget section, pick a type, fill in the fields, and save.
- **YAML:** add an integration to a reusable `service`, then attach the widget
  and its display options to a `service_tile` in `settings.yaml`.

The general YAML shape is:

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000001
    name: My Service
    launch_url: http://192.168.1.10:PORT
    integration:
      type: <integration-id>
      config:
        # connection fields, including credentials
service_tiles:
  - id: 20000000-0000-4000-8000-000000000001
    service_id: 10000000-0000-4000-8000-000000000001
    widget:
      type: <widget-id>
      config:
        # widget-specific display options
      refresh_interval_ms: 30000  # optional, minimum 5000
```

Credentials in `widget.config` are read server-side only and are never sent to the browser.

**Troubleshooting widget configuration:** If a widget's config fails validation (e.g., a missing required field like `token` or a malformed URL), the tile displays a small warning badge in its corner. Hover the badge to see the specific validation errors in a tooltip. Users with edit permission can click the badge to open the service editor with the widget section focused, then fix the configuration and save.

---

### Plex

Displays live playback and library statistics from a Plex Media Server.

**Prerequisites:** You need your Plex authentication token (`X-Plex-Token`). Find it by signing in to Plex Web, opening any media item's "Get Info" page, clicking "View XML", and copying the `X-Plex-Token` value from the URL.

**YAML example:**

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000020
    name: Plex
    launch_url: http://192.168.1.10:32400
    icon: plex
    integration:
      type: plex
      config:
        url: http://192.168.1.10:32400
        token: YOUR_PLEX_TOKEN
service_tiles:
  - id: 20000000-0000-4000-8000-000000000020
    service_id: 10000000-0000-4000-8000-000000000020
    widget:
      type: plex
      config:
        fields:
          - streams
          - transcodes
          - library_movies
          - library_shows
```

**Config fields:**


| Field    | Required | Description                                                 |
| -------- | -------- | ----------------------------------------------------------- |
| `url`    | Yes      | Base URL of your Plex Media Server                          |
| `token`  | Yes      | `X-Plex-Token` for authentication                           |
| `fields` | No       | List of stats to display (default: `[streams, transcodes]`) |


**Available display fields:**


| Value              | Label       | Description                                 |
| ------------------ | ----------- | ------------------------------------------- |
| `streams`          | Streaming   | Total active sessions                       |
| `transcodes`       | Transcoding | Sessions currently being transcoded         |
| `lan_streams`      | LAN         | Active sessions on the local network        |
| `remote_streams`   | Remote      | Active sessions over the internet           |
| `users`            | Users       | Number of distinct users currently watching |
| `bandwidth`        | Bandwidth   | Total streaming bandwidth (shown in Mbps)   |
| `library_movies`   | Movies      | Total movies across all movie libraries     |
| `library_shows`    | Shows       | Total shows across all TV libraries         |
| `library_episodes` | Episodes    | Total episodes across all TV libraries      |
| `library_music`    | Music       | Total albums across all music libraries     |


The widget only contacts `/status/sessions` or `/library/sections` depending on which fields you configure, so it never makes unnecessary requests.

---

### Tautulli

Displays current Plex activity from Tautulli.

**Prerequisites:** Enable Tautulli's API and copy the generated API key.

**YAML example:**

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000021
    name: Tautulli
    launch_url: http://192.168.1.x:8181
    integration:
      type: tautulli
      config:
        url: http://192.168.1.x:8181
        api_key: <your-tautulli-api-key>
service_tiles:
  - id: 20000000-0000-4000-8000-000000000021
    service_id: 10000000-0000-4000-8000-000000000021
    widget:
      type: tautulli-activity
      config:
        sections:
          - summary
          - sessions
```

**Config fields:**

| Field | Required | Description |
| --- | --- | --- |
| `url` | Yes | Base URL of the Tautulli instance, including any HTTP root |
| `api_key` | Yes | Tautulli API key; used only by Kokpit's server |
| `sections` | No | Non-empty list containing `summary`, `sessions`, or both; defaults to both |

**Summary:**

| Value | Description |
| --- | --- |
| Active | Total active streams |
| Direct Play | Streams played directly |
| Direct Stream | Streams direct streamed |
| Transcoding | Streams currently being transcoded |
| Bandwidth | Total active streaming bandwidth |

**Sessions:** Each active session displays the username, media title and type, playback state, transcode mode, and progress.

Usernames are intentionally displayed. Email, IP, machine/device IDs, file paths, player/platform details, and artwork are discarded server-side.

---

### Sonarr

Two widgets are available for Sonarr: a calendar showing upcoming episodes and a download queue monitor.

**Prerequisites:** An API key from Sonarr → Settings → General → Security.

#### `sonarr-calendar`

Shows upcoming episode air dates for the configured number of days ahead.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000022
    name: Sonarr
    launch_url: http://192.168.1.10:8989
    icon: sonarr
    integration:
      type: sonarr
      config:
        url: http://192.168.1.10:8989
        api_key: YOUR_API_KEY
service_tiles:
  - id: 20000000-0000-4000-8000-000000000022
    service_id: 10000000-0000-4000-8000-000000000022
    widget:
      type: sonarr-calendar
      config:
        days: 7
```


| Field     | Required | Description                              |
| --------- | -------- | ---------------------------------------- |
| `url`     | Yes      | Base URL of your Sonarr instance         |
| `api_key` | Yes      | API key from Sonarr → Settings → General |
| `days`    | No       | Days ahead to show (1–30, default: 7)    |


#### `sonarr-queue`

Shows active downloads with progress bars, status, and ETA.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000023
    name: Sonarr
    launch_url: http://192.168.1.10:8989
    icon: sonarr
    integration:
      type: sonarr
      config:
        url: http://192.168.1.10:8989
        api_key: YOUR_API_KEY
service_tiles:
  - id: 20000000-0000-4000-8000-000000000023
    service_id: 10000000-0000-4000-8000-000000000023
    widget:
      type: sonarr-queue
```


| Field     | Required | Description                              |
| --------- | -------- | ---------------------------------------- |
| `url`     | Yes      | Base URL of your Sonarr instance         |
| `api_key` | Yes      | API key from Sonarr → Settings → General |


---

### Radarr

Two widgets are available for Radarr: a stats overview and a download queue monitor.

**Prerequisites:** An API key from Radarr → Settings → General → Security.

#### `radarr-stats`

Displays a six-stat grid showing the state of your movie library.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000024
    name: Radarr
    launch_url: http://192.168.1.10:7878
    icon: radarr
    integration:
      type: radarr
      config:
        url: http://192.168.1.10:7878
        api_key: YOUR_API_KEY
service_tiles:
  - id: 20000000-0000-4000-8000-000000000024
    service_id: 10000000-0000-4000-8000-000000000024
    widget:
      type: radarr-stats
```


| Field     | Required | Description                              |
| --------- | -------- | ---------------------------------------- |
| `url`     | Yes      | Base URL of your Radarr instance         |
| `api_key` | Yes      | API key from Radarr → Settings → General |


**Displayed stats:**


| Stat      | Description                                               |
| --------- | --------------------------------------------------------- |
| Missing   | Monitored movies without a file that are already released |
| Upcoming  | Movies in "announced" or "in cinemas" status              |
| Wanted    | All monitored movies without a file                       |
| Queued    | Total items currently in the download queue               |
| Available | Movies with a downloaded file                             |
| Total     | All movies tracked in Radarr                              |


#### `radarr-queue`

Shows active movie downloads with progress bars, status, and ETA.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000025
    name: Radarr
    launch_url: http://192.168.1.10:7878
    icon: radarr
    integration:
      type: radarr
      config:
        url: http://192.168.1.10:7878
        api_key: YOUR_API_KEY
service_tiles:
  - id: 20000000-0000-4000-8000-000000000025
    service_id: 10000000-0000-4000-8000-000000000025
    widget:
      type: radarr-queue
```


| Field     | Required | Description                              |
| --------- | -------- | ---------------------------------------- |
| `url`     | Yes      | Base URL of your Radarr instance         |
| `api_key` | Yes      | API key from Radarr → Settings → General |


---

### Prowlarr

Displays indexer health and lifetime grab statistics from Prowlarr.

**Prerequisites:** An API key from Prowlarr → Settings → General → Security.

#### `prowlarr-stats`

Shows a four-stat grid: total indexers, enabled indexers, failing indexers (highlighted in red when non-zero), and total grabs across all time.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000026
    name: Prowlarr
    launch_url: http://192.168.1.10:9696
    icon: prowlarr
    integration:
      type: prowlarr
      config:
        url: http://192.168.1.10:9696
        api_key: YOUR_API_KEY
service_tiles:
  - id: 20000000-0000-4000-8000-000000000026
    service_id: 10000000-0000-4000-8000-000000000026
    widget:
      type: prowlarr-stats
```


| Field     | Required | Description                                |
| --------- | -------- | ------------------------------------------ |
| `url`     | Yes      | Base URL of your Prowlarr instance         |
| `api_key` | Yes      | API key from Prowlarr → Settings → General |


**Displayed stats:**


| Stat        | Description                                                  |
| ----------- | ------------------------------------------------------------ |
| Indexers    | Total number of configured indexers                          |
| Enabled     | Indexers currently enabled                                   |
| Failing     | Indexers with an active error status (shown in red when > 0) |
| Total Grabs | Cumulative grab count across all indexers and history        |


---

### qBittorrent

Two widgets are available for qBittorrent: a transfer stats overview and a live torrent list.

**Prerequisites:** WebUI enabled (Options → Web UI) with a username and password — the widget authenticates via qBittorrent's `auth/login` endpoint, so "Bypass authentication for clients on localhost" alone is not enough.

#### `qbittorrent-stats`

Displays current download/upload speed and session totals.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000027
    name: qBittorrent
    launch_url: http://192.168.1.10:8080
    icon: qbittorrent
    integration:
      type: qbittorrent
      config:
        url: http://192.168.1.10:8080
        username: admin
        password: YOUR_PASSWORD
service_tiles:
  - id: 20000000-0000-4000-8000-000000000027
    service_id: 10000000-0000-4000-8000-000000000027
    widget:
      type: qbittorrent-stats
```


| Field      | Required | Description                     |
| ---------- | -------- | -------------------------------- |
| `url`      | Yes      | Base URL of your qBittorrent WebUI |
| `username` | Yes      | WebUI username                   |
| `password` | Yes      | WebUI password                   |


**Displayed stats:** download speed, upload speed, total downloaded, total uploaded.

#### `qbittorrent-torrents`

Shows a scrollable list of all torrents with a progress bar and per-torrent download/upload speed.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000028
    name: qBittorrent Torrents
    integration:
      type: qbittorrent
      config:
        url: http://192.168.1.10:8080
        username: admin
        password: YOUR_PASSWORD
service_tiles:
  - id: 20000000-0000-4000-8000-000000000028
    service_id: 10000000-0000-4000-8000-000000000028
    widget:
      type: qbittorrent-torrents
```

Takes the same `url` / `username` / `password` fields as `qbittorrent-stats`.

---

### SABnzbd

Displays download queue speed, item count, and total queue size.

**Prerequisites:** An API key from SABnzbd → Config → General → Security.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000029
    name: SABnzbd
    launch_url: http://192.168.1.10:8080
    icon: sabnzbd
    integration:
      type: sabnzbd
      config:
        url: http://192.168.1.10:8080
        apikey: YOUR_API_KEY
service_tiles:
  - id: 20000000-0000-4000-8000-000000000029
    service_id: 10000000-0000-4000-8000-000000000029
    widget:
      type: sabnzbd
```


| Field    | Required | Description                        |
| -------- | -------- | ----------------------------------- |
| `url`    | Yes      | Base URL of your SABnzbd instance   |
| `apikey` | Yes      | API key from Config → General → Security |


**Displayed stats:** download speed, queue item count, total queue size.

---

### Seerr

Two widgets are available for Seerr. Both are also compatible with Jellyseerr and Overseerr, which share the same API.

**Prerequisites:** An API key from Settings → General → API Key.

#### `seerr-stats`

Displays a four-stat grid summarising the current state of all media requests.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000030
    name: Seerr
    launch_url: http://192.168.1.10:5055
    icon: seerr
    integration:
      type: seerr
      config:
        url: http://192.168.1.10:5055
        api_key: YOUR_API_KEY
service_tiles:
  - id: 20000000-0000-4000-8000-000000000030
    service_id: 10000000-0000-4000-8000-000000000030
    widget:
      type: seerr-stats
```


| Field     | Required | Description                     |
| --------- | -------- | ------------------------------- |
| `url`     | Yes      | Base URL of your Seerr instance |
| `api_key` | Yes      | API key from Settings → General |


**Displayed stats:**


| Stat      | Description                                        |
| --------- | -------------------------------------------------- |
| Pending   | Requests awaiting approval                         |
| Approved  | Requests approved but not yet available            |
| Available | Requests where the media has been fully downloaded |
| Total     | All requests regardless of status                  |


#### `seerr-requests`

Shows a scrollable list of the 15 most recently submitted requests. Each row displays a colour-coded status badge (pending / approved / available / declined), a media type chip (movie / tv), the title, the requester's name, and a relative timestamp.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000031
    name: Seerr Requests
    integration:
      type: seerr
      config:
        url: http://192.168.1.10:5055
        api_key: YOUR_API_KEY
service_tiles:
  - id: 20000000-0000-4000-8000-000000000031
    service_id: 10000000-0000-4000-8000-000000000031
    widget:
      type: seerr-requests
```


| Field     | Required | Description                     |
| --------- | -------- | ------------------------------- |
| `url`     | Yes      | Base URL of your Seerr instance |
| `api_key` | Yes      | API key from Settings → General |


A request whose media has become fully available is shown with an **available** badge regardless of its underlying request status.

---

### Immich

Shows global Immich media and storage stats for your instance.

**Prerequisites:** An API key from Immich user settings with permission to read server statistics.

#### `immich-stats`

Displays photos, videos, total storage usage, photo storage usage, and video storage usage.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000032
    name: Immich
    launch_url: http://192.168.1.10:2283
    icon: immich
    integration:
      type: immich
      config:
        url: http://192.168.1.10:2283/api
        api_key: YOUR_API_KEY
service_tiles:
  - id: 20000000-0000-4000-8000-000000000032
    service_id: 10000000-0000-4000-8000-000000000032
    widget:
      type: immich-stats
```


| Field     | Required | Description                                      |
| --------- | -------- | ------------------------------------------------ |
| `url`     | Yes      | Immich API base URL (usually ending with `/api`) |
| `api_key` | Yes      | API key from Immich user settings                |



| Stat       | Description                          |
| ---------- | ------------------------------------ |
| Photos     | Total number of photos               |
| Videos     | Total number of videos               |
| Storage    | Total storage usage across all media |
| Photo Size | Storage used by photos               |
| Video Size | Storage used by videos               |


---

### Netdata

Seven composable widgets showing live system metrics from a [Netdata](https://www.netdata.cloud/) agent. Each is a separate tile, so pick the ones you want. All share the same underlying `allmetrics` fetch per Netdata instance (cached briefly server-side), so adding several doesn't multiply requests to Netdata.

**Prerequisites:** A running Netdata agent (default port `19999`), reachable from the Kokpit container. If the agent is secured, generate an API token in Netdata's `netdata.conf`.

**Common config fields** (all seven widgets):


| Field             | Required | Description                                                              |
| ----------------- | -------- | -------------------------------------------------------------------------- |
| `url`             | Yes      | Base URL of your Netdata agent, e.g. `http://192.168.1.10:19999`         |
| `api_token`       | No       | Bearer token, if the agent requires auth                                 |
| `history_minutes` | No       | Sparkline lookback window, 1–60 (default: 10) — CPU, RAM, Network, Disk I/O, and Sensor only |


| Widget type          | Name              | Shows                                                        |
| --------------------- | ----------------- | ------------------------------------------------------------- |
| `netdata-cpu`         | Netdata CPU       | Total CPU utilization, with a sparkline                       |
| `netdata-ram`         | Netdata RAM       | Used / total RAM, with a sparkline                            |
| `netdata-net`         | Netdata Network   | Inbound and outbound throughput, each with a sparkline        |
| `netdata-disk-io`     | Netdata Disk I/O  | Read and write throughput, each with a sparkline              |
| `netdata-disk-space`  | Netdata Disk Space | Used / total space for a mount point (no sparkline)          |
| `netdata-load`        | Netdata Load      | 1/5/15-minute load averages (no sparkline)                    |
| `netdata-sensor`      | Netdata Sensor    | A single sensor chart's average value, with a sparkline       |

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000052
    name: CPU
    launch_url: http://192.168.1.10:19999
    integration:
      type: netdata
      config:
        url: http://192.168.1.10:19999
  - id: 10000000-0000-4000-8000-000000000053
    name: RAM
    launch_url: http://192.168.1.10:19999
    integration:
      type: netdata
      config:
        url: http://192.168.1.10:19999
service_tiles:
  - id: 20000000-0000-4000-8000-000000000052
    service_id: 10000000-0000-4000-8000-000000000052
    widget:
      type: netdata-cpu
  - id: 20000000-0000-4000-8000-000000000053
    service_id: 10000000-0000-4000-8000-000000000053
    widget:
      type: netdata-ram
```

`netdata-disk-space` additionally accepts an optional `chart_id` (default `disk_space._`, the root filesystem) to target another mounted volume:

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000054
    name: Disk Space
    launch_url: http://192.168.1.10:19999
    integration:
      type: netdata
      config:
        url: http://192.168.1.10:19999
service_tiles:
  - id: 20000000-0000-4000-8000-000000000054
    service_id: 10000000-0000-4000-8000-000000000054
    widget:
      type: netdata-disk-space
      config:
        chart_id: disk_space._mnt_storage
```

`netdata-sensor` requires a `chart_id` (no default — sensors vary per host) and accepts an optional `label` to override the tile's display name:

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000055
    name: CPU Temp
    launch_url: http://192.168.1.10:19999
    integration:
      type: netdata
      config:
        url: http://192.168.1.10:19999
service_tiles:
  - id: 20000000-0000-4000-8000-000000000055
    service_id: 10000000-0000-4000-8000-000000000055
    widget:
      type: netdata-sensor
      config:
        chart_id: sensors.coretemp_isa_0000
        label: CPU Temp
```

Find available chart IDs at `<netdata-url>/api/v1/charts` — look for `disk_space.*` mount points or `sensors.*` charts with units like Celsius, Fahrenheit, or RPM.

---

### Unraid

Displays array state, used/total storage, disk count, disk errors, and parity check status from an Unraid server.

**Prerequisites:** An API key from Unraid → Settings → Management Access → API Keys. Unraid's GraphQL API must be reachable from the Kokpit container.

#### `unraid-stats`

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000033
    name: Unraid
    launch_url: http://192.168.1.10
    icon: unraid
    integration:
      type: unraid
      config:
        url: http://192.168.1.10
        api_key: YOUR_API_KEY
service_tiles:
  - id: 20000000-0000-4000-8000-000000000033
    service_id: 10000000-0000-4000-8000-000000000033
    widget:
      type: unraid-stats
```


| Field     | Required | Description                                              |
| --------- | -------- | ---------------------------------------------------------- |
| `url`     | Yes      | Base URL of your Unraid server                            |
| `api_key` | Yes      | API key from Settings → Management Access → API Keys      |


**Displayed stats:**


| Stat   | Description                                                  |
| ------ | -------------------------------------------------------------- |
| Array  | Current array state (started, stopped, etc.)                  |
| Used   | Used / total array storage, with percentage                   |
| Disks  | Number of data disks in the array                              |
| Errors | Disks reporting an error status                                |
| Parity | Parity check status and error count, if configured (shown only when parity data is available) |


---

### Tdarr

Displays transcoding queue status, worker activity, and storage savings from Tdarr.

**Prerequisites:** Access to the Tdarr Server API. No API key is required by default on a local network; the optional `apikey` is only needed if you have enabled it in Tdarr settings.

#### `tdarr-stats`

Shows a six-stat grid: transcode queue count, health checks in queue, errored item count, space saved, active workers, and current frames per second.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000034
    name: Tdarr
    launch_url: http://192.168.1.10:8265
    icon: tdarr
    integration:
      type: tdarr
      config:
        url: http://192.168.1.10:8265
        apikey: YOUR_API_KEY_IF_ENABLED
service_tiles:
  - id: 20000000-0000-4000-8000-000000000034
    service_id: 10000000-0000-4000-8000-000000000034
    widget:
      type: tdarr-stats
```


| Field    | Required | Description                                                      |
| -------- | -------- | ---------------------------------------------------------------- |
| `url`    | Yes      | Base URL of your Tdarr Server (default port 8265)                |
| `apikey` | No       | API key from Tdarr, if enabled; omit if no auth is configured    |


**Displayed stats:**


| Stat                | Description                                             |
| ------------------- | ------------------------------------------------------- |
| Transcode Queue     | Number of items in the transcode queue                  |
| Health Checks       | Number of items in the health checks queue              |
| Errored             | Number of items that encountered errors                 |
| Space Saved         | Total storage saved through transcoding, reported in GB and formatted for display |
| Workers (active)    | Number of active transcode workers currently running    |
| FPS                 | Current frames per second across all active transcoders |


---

### Actual Budget

Displays budget summary, category spending, account balances, and upcoming bills from a self-hosted Actual Budget instance. Reading data requires a separate `jhonderson/actual-http-api` sidecar container — Actual Budget has no built-in HTTP/REST read API (only a Node.js `@actual-app/api` package for programmatic access), so the sidecar acts as a JSON bridge to your encrypted budget.

**Prerequisites:** A running Actual Budget server and an `actual-http-api` sidecar container with credentials configured. The sidecar's API key is what you configure in Kokpit; Kokpit never sees your Actual server password.

**Critical setup step — read this first:** Add the sidecar to your `docker-compose.yml`:

```yaml
services:
  actual-http-api:
    image: jhonderson/actual-http-api:26.7.0
    environment:
      # Your Actual Budget server connection (the sidecar only; Kokpit never sees this)
      ACTUAL_SERVER_URL: http://actual-server:5006
      ACTUAL_SERVER_PASSWORD: your-actual-server-password

      # Generate a long random string for the sidecar's own API auth
      # This is what you'll put in Kokpit's api_key field
      API_KEY: generate-a-long-random-string-here

      NODE_ENV: production
    volumes:
      - ./actual-http-api-data:/data
    restart: unless-stopped
```

Then pin the sidecar's image tag to match your Actual server's version line (e.g. both `26.7.0`). A mismatch causes cryptic sync errors.

**Three distinct secrets — do not confuse them:**

1. **Actual server password** — your budget's login password. Goes in the sidecar's `ACTUAL_SERVER_PASSWORD` env var. Kokpit never sees it.
2. **Sidecar `API_KEY`** — generate a long random string (use `openssl rand -hex 32` or similar). This is what goes in Kokpit's `api_key` widget config field.
3. **Budget encryption password** *(optional)* — only needed if your budget is end-to-end encrypted. If you have one, put it in the widget's `encryption_password` field.

**Find your Sync ID:** In Actual Budget, go to Settings → Show advanced settings → Sync ID. Copy that value into the widget's `budget_sync_id` field.

**Privacy mode (default on):** Amounts are blurred by default and reveal on hover or focus. Set `privacy_mode: false` in the widget config to always show amounts.

**Two different URLs, on purpose**, and they are resolved by different things:

- The service's `launch_url` is where **your browser** navigates when you click the tile, so it must be reachable from your machine — a LAN address or hostname like `http://192.168.1.x:5006`, pointing at your Actual Budget server. A Docker service name such as `actual-server` will *not* work here: it only resolves between containers, so the tile would fail to open even though the widget loads fine.
- `service.integration.config.url` is fetched **server-side by Kokpit**, so it can use Docker DNS (`http://actual-http-api:5007`) and should point at the sidecar, never at Actual Budget itself.

Pointing both at the sidecar gives you a tile that opens raw JSON instead of your budget.

#### `actualbudget-summary`

Displays six key statistics: To Assign, Budgeted, Spent, Remaining, count of overspent categories, and Net Worth.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000035
    name: Actual Budget
    launch_url: http://192.168.1.x:5006     # your Actual Budget server, reachable from your browser
    icon: di-actual-budget
    integration:
      type: actualbudget
      config:
        url: http://actual-http-api:5007   # the sidecar — what the widget fetches from
        api_key: your-sidecar-api-key
        budget_sync_id: your-sync-id
        # encryption_password: ""     # optional; only for E2E-encrypted budgets
service_tiles:
  - id: 20000000-0000-4000-8000-000000000035
    service_id: 10000000-0000-4000-8000-000000000035
    widget:
      type: actualbudget-summary
      config:
        # currency: USD               # optional; ISO 4217 code (default: USD)
        # locale: en-US               # optional; e.g. en-GB, de-DE (defaults to server locale)
        # timezone: Europe/Warsaw     # optional; IANA name (defaults to the server's timezone)
        # privacy_mode: true          # optional; blur amounts until hover (default: true)
```

#### `actualbudget-categories`

Shows per-category spending vs. budget as a sorted list with progress bars and colour-coded status (green, yellow, or red for overspent).

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000036
    name: Budget Categories
    launch_url: http://192.168.1.x:5006     # your Actual Budget server, reachable from your browser
    icon: di-actual-budget
    integration:
      type: actualbudget
      config:
        url: http://actual-http-api:5007   # the sidecar — what the widget fetches from
        api_key: your-sidecar-api-key
        budget_sync_id: your-sync-id
        # encryption_password: ""     # optional; only for E2E-encrypted budgets
service_tiles:
  - id: 20000000-0000-4000-8000-000000000036
    service_id: 10000000-0000-4000-8000-000000000036
    widget:
      type: actualbudget-categories
      config:
        # limit: 8                    # optional; top N categories by spend (1–50, default: 8)
        # hide_income: true           # optional; exclude income categories (default: true)
        # hide_empty: true            # optional; exclude categories with no budget/spend (default: true)
        # currency: USD               # optional; ISO 4217 code (default: USD)
        # locale: en-US               # optional; e.g. en-GB, de-DE (defaults to server locale)
        # timezone: Europe/Warsaw     # optional; IANA name (defaults to the server's timezone)
        # privacy_mode: true          # optional; blur amounts until hover (default: true)
```

#### `actualbudget-accounts`

Lists all accounts with their current balance, filtered by closed/off-budget status, plus a Net worth total row.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000037
    name: Budget Accounts
    launch_url: http://192.168.1.x:5006     # your Actual Budget server, reachable from your browser
    icon: di-actual-budget
    integration:
      type: actualbudget
      config:
        url: http://actual-http-api:5007   # the sidecar — what the widget fetches from
        api_key: your-sidecar-api-key
        budget_sync_id: your-sync-id
        # encryption_password: ""     # optional; only for E2E-encrypted budgets
        # (no timezone field here — this widget's balances aren't resolved
        #  against a date, so nothing in it reads config.timezone)
service_tiles:
  - id: 20000000-0000-4000-8000-000000000037
    service_id: 10000000-0000-4000-8000-000000000037
    widget:
      type: actualbudget-accounts
      config:
        # exclude_closed: true        # optional; hide closed accounts (default: true)
        # exclude_offbudget: false    # optional; hide off-budget accounts (default: false)
        # currency: USD               # optional; ISO 4217 code (default: USD)
        # locale: en-US               # optional; e.g. en-GB, de-DE (defaults to server locale)
        # privacy_mode: true          # optional; blur amounts until hover (default: true)
```

#### `actualbudget-schedules`

Shows upcoming bills and income rules, sorted by due date, with relative due dates ("today", "3d", "overdue") and a footer showing how many are due soon — within `min(7, days_ahead)` days — or already overdue. Set `days_ahead` below 7 and the footer's own label shrinks to match, so it never promises a window `days_ahead` has already excluded the data for.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000038
    name: Budget Schedule
    launch_url: http://192.168.1.x:5006     # your Actual Budget server, reachable from your browser
    icon: di-actual-budget
    integration:
      type: actualbudget
      config:
        url: http://actual-http-api:5007   # the sidecar — what the widget fetches from
        api_key: your-sidecar-api-key
        budget_sync_id: your-sync-id
        # encryption_password: ""     # optional; only for E2E-encrypted budgets
service_tiles:
  - id: 20000000-0000-4000-8000-000000000038
    service_id: 10000000-0000-4000-8000-000000000038
    widget:
      type: actualbudget-schedules
      config:
        # limit: 6                    # optional; top N schedules (1–50, default: 6)
        # days_ahead: 30              # optional; schedules due within N days (1–365, default: 30)
        # currency: USD               # optional; ISO 4217 code (default: USD)
        # locale: en-US               # optional; e.g. en-GB, de-DE (defaults to server locale)
        # timezone: Europe/Warsaw     # optional; IANA name (defaults to the server's timezone)
        # privacy_mode: true          # optional; blur amounts until hover (default: true)
```

**Config fields (shared across all four widgets):**

| Field | Required | Description |
|---|---|---|
| `url` | Yes | Base URL of your actual-http-api sidecar (e.g. `http://actual-http-api:5007`). **Not** your Actual Budget server URL. |
| `api_key` | Yes | The sidecar's `API_KEY` environment variable. |
| `budget_sync_id` | Yes | Your budget's Sync ID from Actual → Settings → Show advanced settings. |
| `encryption_password` | No | Only required for end-to-end-encrypted budgets. |
| `currency` | No | ISO 4217 code (default: `USD`). Controls amount formatting. |
| `locale` | No | Locale identifier (e.g. `en-GB`, `de-DE`; default: server locale). |
| `privacy_mode` | No | When `true` (default), amounts are blurred and reveal on hover/focus. Set to `false` to always show them. |

**`timezone` (summary, categories, schedules only — not accounts):**

| Field | Required | Description |
|---|---|---|
| `timezone` | No | IANA timezone name (e.g. `Europe/Warsaw`; default: the server's timezone). Used to resolve the current budget month (summary, categories) or schedule due-date status — "today"/"overdue" (schedules) — Kokpit's own container runs UTC unless you set `TZ` on it, so set this if you're not in UTC and see month or due-date figures off by a few hours around midnight. Not offered on `actualbudget-accounts`: account balances aren't resolved against a date, so nothing there reads it. |

**Per-widget extra fields:**

| Widget | Field | Type | Description |
|---|---|---|---|
| `actualbudget-categories` | `limit` | int | Top N categories by spend, 1–50 (default: 8). |
| `actualbudget-categories` | `hide_income` | bool | Exclude income categories (default: `true`). |
| `actualbudget-categories` | `hide_empty` | bool | Exclude categories with no budget or spending (default: `true`). |
| `actualbudget-accounts` | `exclude_closed` | bool | Hide closed accounts (default: `true`). |
| `actualbudget-accounts` | `exclude_offbudget` | bool | Hide off-budget accounts (default: `false`). |
| `actualbudget-schedules` | `limit` | int | Top N schedules, 1–50 (default: 6). |
| `actualbudget-schedules` | `days_ahead` | int | Schedules due within N days, 1–365 (default: 30). |

**Displayed stats / information:**

| Widget | Shows |
|---|---|
| `actualbudget-summary` | To Assign (ready to budget), Total Budgeted, Total Spent (abs), Remaining balance, count of overspent categories, Net Worth (sum of all account balances). |
| `actualbudget-categories` | Category name, Spent / Budgeted amounts with progress bar, colour status — mutually exclusive: green under 85% spent, yellow 85–100% spent, red when the category is overspent (balance below zero, which takes priority over the percentage). Sorted by % spent descending. |
| `actualbudget-accounts` | Account name, off-budget marker, current balance. Footer shows Net worth total. |
| `actualbudget-schedules` | Payee name, amount, relative due date. Footer shows count due within `min(7, days_ahead)` days or overdue (e.g. "Due within 3 days or overdue" when `days_ahead: 3`). |

**Read-only:** This integration never modifies your budget — it only reads data from the sidecar.

---

### Docker

Lists the containers running on the Docker host: a colored state dot, container name, image, and uptime per row, plus a "running / total" summary.

**Prerequisites:** Kokpit needs read access to the Docker socket. Mount it read-only into the container:

```yaml
services:
  kokpit:
    # ...
    volumes:
      - ./data:/data
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

The image's entrypoint automatically grants its non-root runtime user membership in the socket's owning group, so no extra `group_add` configuration is needed.

**YAML example:**

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000050
    name: Docker
    icon: docker
    integration:
      type: docker
      config: {}
service_tiles:
  - id: 20000000-0000-4000-8000-000000000050
    service_id: 10000000-0000-4000-8000-000000000050
    widget:
      type: docker
      config: {}
```

**Config fields:**


| Field         | Required | Description                                                                                             |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `socket_path` | No       | Unix socket path inside the Kokpit container (default: `KOKPIT_DOCKER_SOCKET` env, then `/var/run/docker.sock`) |
| `max_items`   | No       | Containers shown in the list, 1–50 (default: 10)                                                        |


Stopped containers count toward the total but are not listed. Paused and restarting containers appear with a yellow dot.

**Security note:** The Docker socket is a powerful interface — even read-only access exposes details about everything running on the host, and write access is root-equivalent. Kokpit only ever issues read-only calls (`GET /_ping` to negotiate the API version, then `GET /containers/json`) and never sends raw Docker API data to the browser. The widget talks to Docker over a **unix socket only** — TCP endpoints such as [docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy)'s default `:2375` listener can't be used as `socket_path` directly. For a hardened setup, bridge a filtered proxy (with only `CONTAINERS=1` enabled) back to a unix socket and point `socket_path` at the bridge, e.g. with a socat sidecar:

```yaml
  docker-proxy-bridge:
    image: alpine/socat
    command: UNIX-LISTEN:/sockets/docker.sock,fork,mode=666 TCP:docker-socket-proxy:2375
    volumes:
      - sockets:/sockets
```

Native TCP Docker host support is on the backlog.

---

### System Stats

Shows live host metrics — CPU usage, RAM, disk usage, and network I/O — read directly from the machine Kokpit runs on via `/proc` (and `statfs` for disk), plus an optional Docker container running/total summary. Unlike the Netdata widget, it needs no external monitoring service.

**Prerequisites:** By default, it reads the `/proc` of the environment Kokpit runs in. When running Kokpit in Docker and you want host-wide CPU/RAM/network figures, bind-mount the host's `/proc` read-only and point the widget at it with `KOKPIT_PROC_PATH` (or the `proc_path` config field). For host disk usage, mount the host path you want to measure and set `disk_path`. For the Docker container summary, mount the Docker socket as described in the Docker widget section above (note its security caveats). Example compose volumes/env:

```yaml
services:
  kokpit:
    volumes:
      - ./data:/data
      - /proc:/host/proc:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      KOKPIT_PROC_PATH: /host/proc
```

**YAML example:**

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000051
    name: System
    icon: mdi-server
service_tiles:
  - id: 20000000-0000-4000-8000-000000000051
    service_id: 10000000-0000-4000-8000-000000000051
    widget:
      type: system-stats
      config:
        proc_path: /host/proc   # optional; defaults to /proc (or KOKPIT_PROC_PATH)
        disk_path: /             # optional; filesystem to report disk usage for
        fields:
          - cpu
          - memory
          - disk
          - network
          - load
          - docker
        docker_socket_path: /var/run/docker.sock   # only used when "docker" is in fields
```

**Config fields:**


| Field                | Required | Description                                                                                                              |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `proc_path`          | No       | Path to procfs. Defaults to the `KOKPIT_PROC_PATH` env var, then `/proc`. Bind-mount the host's `/proc` and set this for host-wide metrics in Docker. |
| `disk_path`          | No       | Filesystem mount to report disk usage for (default `/`).                                                                |
| `interface`          | No       | Network interface to measure. Leave empty to sum all non-loopback interfaces.                                           |
| `docker_socket_path` | No       | Docker socket for the container overview. Defaults to `KOKPIT_DOCKER_SOCKET`, then `/var/run/docker.sock`. Only used when `docker` is listed in `fields`. |
| `fields`             | No       | Which stats to display: any of `cpu`, `memory`, `disk`, `network`, `load`, `docker` (default: `cpu, memory, disk, network`). |


CPU and network rates come from two `/proc` samples taken a fraction of a second apart per refresh. If the Docker socket is unavailable, the container line is quietly omitted (as "Docker unavailable") without affecting the other stats.

**Security note:** The `/proc` and `statfs` reads are local and read-only, full stop. The Docker field is different: Kokpit itself only ever *issues* read-only API calls (`GET /_ping`, `GET /containers/json`), but access to the socket is effectively root-equivalent on the host — the `:ro` mount flag only makes the socket file node read-only, it does not restrict what the Docker Engine API will do for anyone who can reach it. See the hardening guidance (filtered socket proxy) in the Docker widget section above if that matters for your threat model. `proc_path`, `disk_path`, and `docker_socket_path` come from trusted admin config in `settings.yaml`, not from end users. No network requests are made to read the system metrics, so the widget stays fully air-gappable.

---

## Contributing

Contributions are welcome. Please open an issue first to discuss significant changes before sending a pull request.

- **Bug reports & feature requests:** open a GitHub issue
- **Pull requests:** branch from `main`, keep changes focused, and make sure `npm run lint`, `npm run type-check`, and `npm test` all pass before submitting
- Follow the existing code style — ESLint and TypeScript strict mode are enforced in CI

## License

MIT — see [LICENSE](LICENSE) for details.
