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
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
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

**Add a service tile:**

```yaml
services:
  - name: Jellyfin
    url: http://192.168.1.10:8096
    icon: jellyfin
    description: Media server
    group: Media
```

**Set a tile size:**

```yaml
services:
  - name: Plex
    url: http://192.168.1.10:32400
    size: large  # normal (default) | wide | tall | large
```

Sizes are col×row spans in the dashboard grid: `normal` 1×1, `wide` 2×1, `tall` 1×2, `large` 2×2. When omitted, a widget's preferred size is used, falling back to `normal`. The legacy `position: {col, row, width, height}` field is **deprecated** — it's still parsed (and migrated to an equivalent size on load) but logs a deprecation warning; use `size` plus array order instead. Both `size` and array order can also be set from the Services tab in the settings panel.

**Group services into ordered sections:**

```yaml
groups:
  - name: Media
    collapsed: false  # default expanded; live state is saved per-browser
    columns: 4        # optional per-group column override
  - name: Downloads

services:
  - name: Jellyfin
    group: Media
```

Array order in `groups:` is display order. A group referenced by a service but not listed here is auto-appended (today's alphabetical behavior), so this block is optional. Ungrouped services render as their own section, placed first or last via `layout.ungrouped: first | last` (default `last`). Groups are collapsible on the dashboard; the `collapsed` key only sets the default — collapse state itself is remembered per device. The Groups tab in the settings panel covers reordering, renaming (cascades to member services), declaring, deleting, and setting these options.

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
  - name: Sonarr
    icon: di-sonarr        # dashboard-icons
  - name: GitHub
    icon: sh-github        # selfh.st icons
  - name: Home
    icon: mdi-home         # Material Design Icons
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
- **Manage a group** from its header kebab: rename (cascades to every member service and bookmark, and carries over the collapse state), set or clear a per-group column override, or delete it (members become ungrouped). A group that exists only because a service referenced its name gets a **Declare group** action first — that's what makes it orderable.
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


| Field     | Required | Description                              |
| --------- | -------- | ---------------------------------------- |
| `url`     | Yes      | Base URL of your Sonarr instance         |
| `api_key` | Yes      | API key from Sonarr → Settings → General |
| `days`    | No       | Days ahead to show (1–30, default: 7)    |


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
  - name: Radarr
    url: http://192.168.1.10:7878
    icon: radarr
    widget:
      type: radarr-stats
      config:
        url: http://192.168.1.10:7878
        api_key: YOUR_API_KEY
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
  - name: Radarr
    url: http://192.168.1.10:7878
    icon: radarr
    widget:
      type: radarr-queue
      config:
        url: http://192.168.1.10:7878
        api_key: YOUR_API_KEY
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
  - name: Prowlarr
    url: http://192.168.1.10:9696
    icon: prowlarr
    widget:
      type: prowlarr-stats
      config:
        url: http://192.168.1.10:9696
        api_key: YOUR_API_KEY
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

### Seerr

Two widgets are available for Seerr. Both are also compatible with Jellyseerr and Overseerr, which share the same API.

**Prerequisites:** An API key from Settings → General → API Key.

#### `seerr-stats`

Displays a four-stat grid summarising the current state of all media requests.

```yaml
services:
  - name: Seerr
    url: http://192.168.1.10:5055
    icon: seerr
    widget:
      type: seerr-stats
      config:
        url: http://192.168.1.10:5055
        api_key: YOUR_API_KEY
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
  - name: Seerr Requests
    widget:
      type: seerr-requests
      config:
        url: http://192.168.1.10:5055
        api_key: YOUR_API_KEY
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
  - name: Immich
    url: http://192.168.1.10:2283
    icon: immich
    widget:
      type: immich-stats
      config:
        url: http://192.168.1.10:2283/api
        api_key: YOUR_API_KEY
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
  - name: Docker
    icon: docker
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

**Prerequisites:** By default it reads the `/proc` of the environment Kokpit runs in. When running Kokpit in Docker and you want host-wide CPU/RAM/network figures, bind-mount the host's `/proc` read-only and point the widget at it with `KOKPIT_PROC_PATH` (or the `proc_path` config field). For host disk usage, mount the host path you want to measure and set `disk_path`. For the Docker container summary, mount the Docker socket read-only exactly as described in the Docker widget section above. Example compose volumes/env:

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
  - name: System
    icon: mdi-server
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

**Security note:** All reads are local and read-only — procfs files and a `statfs` disk call, plus (optionally) the same read-only Docker socket calls the Docker widget makes. `proc_path`, `disk_path`, and `docker_socket_path` come from trusted admin config in `settings.yaml`, not from end users. No network requests are made to read the system metrics, so the widget stays fully air-gappable.

---

## Contributing

Contributions are welcome. Please open an issue first to discuss significant changes before sending a pull request.

- **Bug reports & feature requests:** open a GitHub issue
- **Pull requests:** branch from `main`, keep changes focused, and make sure `npm run lint`, `npm run type-check`, and `npm test` all pass before submitting
- Follow the existing code style — ESLint and TypeScript strict mode are enforced in CI

## License

MIT — see [LICENSE](LICENSE) for details.