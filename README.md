# kokpit

A self-hosted homelab dashboard built with Next.js. Kokpit gives you a single place to access all your self-hosted services, with live status indicators, system widgets, and a fully YAML-driven configuration — no database config required.

## What it does

Kokpit is a personal dashboard for homelab and self-hosted setups. You define your services, widgets, and layout in a single `settings.yaml` file, and Kokpit renders a clean, themeable dashboard accessible from any browser.

See [docs/Roadmap.md](docs/Roadmap.md) for full details on roadmap and priority levels.

## Installation

### Docker (recommended)

#### Quick start with pre-built image

If you just want to run Kokpit, use the pre-built image from GitHub Container Registry.

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
      # Optional — a stable random string for short-lived 2FA challenges and
      # other server secrets. If omitted, Kokpit persists a generated secret
      # in /data. Login sessions are opaque tokens stored (hashed) in SQLite.
      # KOKPIT_SESSION_SECRET: <generate with `openssl rand -hex 32`>

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

To pin to a specific version instead of `latest`, replace `<version>` with a
published release version:

```yaml
    image: ghcr.io/pmyszczynski/kokpit:<version>
```

#### Building from source

If you want to build the image yourself or need the latest unreleased features:

1. Clone the repo:

```bash
git clone https://github.com/pmyszczynski/kokpit.git
cd kokpit
```

1. Keep the `./data:/data` volume. Kokpit generates its own private server key in `/data/.session_secret` and reuses it after restarts. If you manage this key yourself, generate a random value with `openssl rand -hex 32` and set the optional `KOKPIT_SESSION_SECRET` override in Compose.
2. Start the production container:

```bash
docker compose up kokpit --build
```

**For Docker image releases, versioning, and GHCR publishing, see [docs/DOCKER_RELEASES.md](docs/DOCKER_RELEASES.md).**

#### Replacing the old Compose secret placeholder

Older copies of the repository's Compose file supplied a public placeholder for `KOKPIT_SESSION_SECRET`. Kokpit now rejects that exact value during startup. Stop the container, remove the override to use the generated key, or replace it with a random value from `openssl rand -hex 32`, retain the data volume, and restart.

Without an override, an existing valid `/data/.session_secret` is reused; it is never automatically rotated. If that file contains the old placeholder, stop Kokpit and deliberately replace the file with a generated random value while preserving its private permissions (`0600`), then restart. Do not delete or replace a valid persisted key merely to adopt the new Compose default. Local source installations store this file beside their SQLite database (by default `data/.session_secret`).

Changing the effective key invalidates in-flight two-factor login challenges and existing widget-secret references/configuration revisions. Retry two-factor login and reload open editors before saving. Existing opaque login sessions remain valid because SQLite backs them; revoke those separately through session management when needed. A valid explicit override keeps its current precedence and exact bytes, so keep that value stable across restarts and use the same key for processes sharing one data volume.

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

### Liveness and readiness probes

`GET /api/health` is public liveness: it returns 200 when the HTTP process can
answer, with the artifact's build version and current timestamp. Docker and
Compose keep using this endpoint by default. `GET /api/ready` is a separate,
public, non-cacheable readiness check returning 200 or 503 with fixed state
labels for configuration and SQLite. Neither endpoint exposes settings, paths,
accounts, upstream URLs or error details, and neither depends on an external
integration being online.

Readiness requires the published configuration to still match disk exactly.
Cold initialization and dirty, missing or unreadable YAML return 503. A stable
legacy configuration needing migration reports `restart_required` and remains
503 until deliberate restart/migration, even if some read-only pages still work.
The application startup/watcher lifecycle owns initialization and recovery;
probes do not create or migrate settings, acquire config write locks, open a
database, or repair schema. SQLite is required only when authentication is
enabled, consistently with the explicit `KOKPIT_AUTH_DISABLED=true` override.
An empty first-run user table is ready once its schema is usable. Enabling auth
initializes its database through the application lifecycle before readiness
succeeds.

An initialized database must be open, writable in connection policy, and able
to complete a minimal schema-aware read. Each read waits at most 50ms for SQLite
locks, then restores the application's previous busy timeout. This read probe
cannot guarantee a later write succeeds if storage fills or filesystem
permissions change. Initialization failures need repair through normal
application startup/lifecycle activity; a readiness poll does not retry them.
Both endpoints report the version compiled from `package.json`, including when
the standalone server starts with `node server.js`; runtime npm environment
variables cannot change that artifact identity.

To make Compose health describe readiness explicitly, override only its probe:

```yaml
services:
  kokpit:
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- \"http://127.0.0.1:$${PORT:-3000}/api/ready\" || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
```

For an image-level override, the equivalent Dockerfile instruction is:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/ready" || exit 1
```

Readiness can delay dependent startup via `depends_on: condition:
service_healthy`, or remove an instance from a separately configured load
balancer. Docker/Compose marks failed checks `unhealthy`; `restart:
unless-stopped` does not restart a still-running unhealthy container, and
Compose does not provide dynamic load-balancer routing or automatic recovery
after startup. Keep liveness and restart decisions separate from temporary
configuration/database problems.

## Usage

Configuration is stored in `settings.yaml`. Source and local development default
to `<project-root>/settings.yaml`; the published Docker image defaults to
`/data/settings.yaml`, so the quick-start volume persists it on the host at
`./data/settings.yaml`. Set `KOKPIT_CONFIG_PATH` to use another location.

The in-app settings panel (accessible via the ⚙ icon in the navbar) has
Appearance, Layout, Groups, Services, Bookmarks, and Authentication tabs. It
reads from and writes back to the same file, and changes take effect without a
restart. You can also edit the YAML directly.

UI saves preserve comments on surviving settings and records, including nested
fields and UUID-identified services/tiles. Comments belonging only to deleted
values are removed. Serialization may normalize indentation or quoting. Ambiguous
changed arrays do not inherit another item's annotations; alias edits that cannot
keep safe ownership are rejected with guidance to edit YAML directly or expand
the aliases before retrying.

The Docker image also defaults `KOKPIT_DB_PATH` to `/data/users.db` and
`KOKPIT_UPLOADS_PATH` to `/data/uploads`; override these only when you need a
different persistent layout. `auth.session_idle_timeout_hours` controls the
server-side inactivity timeout: `0` keeps a session valid until it is revoked.
`KOKPIT_INSECURE_COOKIE=true` disables the secure-cookie flag in production
mode for local HTTP testing; do not use it on an internet-exposed deployment.

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

**Set the canonical generic tile footprint:**

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000002
    name: Plex
    launch_url: http://192.168.1.10:32400
service_tiles:
  - id: 20000000-0000-4000-8000-000000000002
    service_id: 10000000-0000-4000-8000-000000000002
    footprint:
      columnSpan: 3
      rowSpan: 1
```

The dashboard uses non-configurable 108×60px units with an 8px gap and automatically exposes 3, 6, 9, 12, or 15 columns as the viewport grows. A footprint is the exact number of those units a tile occupies. Generic service cards are always 3×1; compact cards deliberately omit secondary content that does not fit. Widgets use their declared exact canvases. Legacy `size`, `position`, `layout.columns`, `layout.row_height`, and per-group `columns` values are migrated to fixed footprints or removed on load.

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

**External YAML updates:**

Already-open dashboards check the authorized source revision every five seconds
while visible and online. Stable changes refresh services, ordering, bookmarks
and appearance automatically, including removal of old CSS/background values.
Comment-only edits also change the revision. One observer serves each protected
browser surface; it does not fetch the full settings document just to check for
changes, and polling never migrates or rewrites the YAML file.

Unsaved settings, dashboard drafts and form input keep their original baseline.
An external change shows a conflict and blocks stale saves until explicit
reload/discard; a clean idle settings panel adopts the new server snapshot.
Theme previews remain while their appearance draft is active. Successful saves
acknowledge their own revision so they do not produce an external-change notice.

Hidden/offline surfaces are masked and widget/status requests pause. Returning
checks access before revealing content or resuming requests. A failed or invalid
configuration check masks the surface and retries with bounded backoff (up to five
minutes); it retains drafts in inaccessible memory. A confirmed authorization
failure clears drafts and follows the existing login/setup flow. Under normal
connectivity, active-tab authorization changes are detected within the five-second
polling interval plus request/render time. This cannot recall content already
delivered to a public browser. Migration-required configuration remains readable
to allowed viewers, with editing blocked until the operator updates the file.

Initial startup still validates the YAML and deployment key before serving. If
startup rejects invalid YAML, repair the file and restart Kokpit. Automatic
recovery here applies to external edits after a successful startup; revision
polling does not bypass startup validation.

**Unsaved changes and navigation:**

The dashboard, settings sections, and service/bookmark forms track unsaved changes.
App-owned exits offer **Stay**, **Discard and continue**, and **Save & continue**
when a valid save is available. A failed save keeps the draft. Settings tabs retain
their work, and a dashboard draft remains available while navigating within the app.
Reloading or closing a page with unsaved work uses the browser's generic warning;
user activation and platform support determine whether it appears.

Same-document browser Back/Forward cannot be universally cancelled by Next.js.
Kokpit instead retains non-secret draft projections in memory for the lifetime of
the protected layout, shows a recovery notice, and rechecks the authorized server
revision before recovered settings can be saved. Recovery stores at most 32 drafts
of 256 KiB each; oversized drafts show a warning. Save before using history when
that warning appears. Passwords, API keys, raw connection/widget configuration,
TOTP/recovery material and URL credentials/query/fragment values are not retained;
re-enter those edits. Untouched sections and form fields use their saved server
values, so recovering another edit does not strip existing URL parameters.
Explicit URL edits retain only their sanitized values. CSS recovery uses a limited
profile and omits a field if it contains quoted strings, escapes, slashes, `?`,
`#`, `@`, `url()` or custom-property
declarations. Numeric/keyword declarations, variable references and color
functions within that profile remain recoverable; hex colors within CSS, ID
selectors, at-rules and other omitted syntax need re-entry. Separate color
settings retain hex values. Recovery uses no localStorage, sessionStorage, or disk
and is cleared by discard, successful save, sign-out, session loss, or
protected-layout teardown. Full reload, browser/app
termination, or memory eviction can still lose unsaved work.

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

Authentication defaults to enabled, including when an `auth` section configures
only the session timeout. Disabling it requires an explicit `enabled: false` or
the environment override above.

Service status checks use saved service URLs, including LAN and Tailscale
addresses. Browser requests identify a saved service rather than supplying a
destination URL. Link-local addresses and known cloud metadata endpoints are
blocked. Redirect responses count as reachable, but Kokpit does not follow them.

## Login sessions

Password login and TOTP verification each allow at most ten failed or pending
attempts per account in a fifteen-minute window. A successful login releases its
own attempt; issuing a TOTP challenge releases only the password-step attempt.
Earlier failures remain until the window ends, and fresh challenges do not reset
the account's TOTP allowance. A shared rolling budget also permits at most 100
password/TOTP checks in any sixty seconds across all accounts, including successful
checks and requests for unknown usernames. Limits persist in SQLite across
restarts and do not trust forwarded IP headers. A blocked request
returns HTTP 429 with `Retry-After` in seconds.

Each password-authenticated TOTP challenge has a unique random identity and a
fixed five-minute expiry. Its five-attempt allowance and single-use state are
stored in SQLite, so restarting Kokpit or using another process cannot reset
the allowance or replay a completed challenge. Distinct challenges may still
accept the same current authenticator code. At most 16 active challenges per
account and 1,024 unexpired challenge records are retained; capacity refusal
returns 429 with `Retry-After` without evicting an active challenge. Login must
restart after expiry, exhaustion or consumption. If writing the browser cookie
fails, its new session is revoked and login must restart; a failed session
insertion rolls the transaction back and allows a retry.

**TOTP upgrade:** challenges issued before durable challenge storage was added
must restart the password step. Existing opaque login sessions remain valid.
Cooperating processes must share the same SQLite file on a supported local
filesystem and the same server signing secret; separately replicated databases
are not supported.

Kokpit keeps you signed in by default. Each browser has a revocable session stored
in `data/users.db`; only a hash of its random cookie token is stored. Preserve the
`/data` volume across container upgrades and restarts.

In **Settings → Authentication**, you can view signed-in browsers and last-used
times, sign out one browser, or sign out all other devices/all devices. Controlling
other sessions and changing authentication settings require your current password.
Enabling 2FA requires your password plus an authenticator code; disabling it requires
a current authenticator code. Either change signs out other devices. Password
recovery and the emergency reset command sign out every device and invalidate
pending 2FA login challenges.

The browser cookie lasts up to a year and renews silently when you return to Kokpit
and while the dashboard is open. Clearing cookies, private browsing, browser
retention policies, or losing the database can still require another login.

An optional inactivity limit is available for shared devices:

```yaml
auth:
  enabled: true
  session_idle_timeout_hours: 0  # 0 or omitted: no automatic expiry
```

A positive whole number (up to 8760) expires a new session after that many hours
without authenticated dashboard requests. Dashboard/widget polling counts as
activity; silent cookie renewal does not. This measures request inactivity, not
keyboard or mouse inactivity, so a dashboard that keeps polling can remain active.
Widget and service-status polling pauses while the document is hidden, the
browser reports offline, or the dashboard's access/configuration gate is closed.
An idle-limited session can therefore expire while you are away; returning follows
the normal login flow. Silent cookie renewal cannot revive an expired session,
and no hidden keepalive is sent to extend the inactivity deadline.
Changing the setting affects new sessions; revoke existing sessions to enforce a
new policy immediately. The UI saves this setting back to YAML.

**Upgrade:** older JWT cookies require one new login. The legacy
`session_ttl_hours` key is accepted but no longer controls login expiry; saving
authentication settings replaces it with `session_idle_timeout_hours`. Persistent
sessions no longer depend on the signing secret. To revoke them, use the session
controls or reset the password.

API clients calling authentication mutation endpoints must send
`X-Kokpit-Request: 1`; cross-site browser mutations are rejected. Tokens should never
be copied into URLs, logs, or browser local storage.

## API request limits

JSON mutation endpoints accept an object, with endpoint-specific field checks.
Malformed JSON or a primitive/array body returns `400`; bodies above these limits
return `413`. Limits count actual streamed UTF-8 bytes, including when
`Content-Length` is missing or incorrect.

| Request | Body limit |
| --- | --- |
| Setup and authentication/session JSON | 16 KiB (16,384 bytes) |
| Icon detection JSON | 64 KiB (65,536 bytes) |
| Widget connection-test JSON | 256 KiB (262,144 bytes) |
| Settings PATCH JSON | 2 MiB (2,097,152 bytes) |
| Saved-service ping JSON | 1 KiB (1,024 bytes; existing limit) |
| Icon multipart upload | 2 MiB decoded file plus 64 KiB total multipart overhead |
| Background multipart upload | 8 MiB decoded file plus 64 KiB total multipart overhead |

Upload envelope limits include every field, filename and boundary; excessive
extra fields can return `413` even if the selected file is small. Existing file
type, content and sanitization checks still apply. Normal-sized clients retain
their existing content-type requirements and error response shapes. Protected
routes authorize before parsing; settings writes recheck the current session,
configuration and revision after parsing. An unauthorized malformed request may
therefore return `401` before JSON validation.

The authentication transport limit is separate from bcrypt's password policy.
Existing passwords that cannot fit in the 16 KiB JSON envelope require the host
password-reset utility; this limit does not silently truncate password input.
Large deployments can edit YAML directly when a complete settings payload exceeds
the API limit. A validated 1,000-service/1,000-tile dashboard with 256 KiB custom
CSS and representative configs for all registered widgets fit the selected limits.

## Edit Mode

An empty dashboard shows a welcome card. When editing is allowed and no services
are saved, it offers **Add your first service** and **More tile options**. These
open the existing service, widget-preset and bookmark forms in edit mode;
changes are staged until **Save & exit**, while **Discard** leaves the saved
configuration intact. Merely opening or cancelling the flow does not create
anything. Catalog services without placed tiles remain saved: the editable card
offers **Add a tile** and **Manage saved services**. The latter opens the general
**Settings** page; select its **Services** tab to manage the catalog. Read-only
viewers see guidance to ask an administrator or update the configuration file,
instead of edit buttons. Declared empty groups do not hide the card;
bookmark-only dashboards and placed service tiles do. The same layout remains
configurable through `settings.yaml`, without a required onboarding wizard.

Click the pencil icon in the navbar (or press `Mod+E` — Cmd+E on macOS, Ctrl+E on Windows/Linux) to edit the dashboard in place. Edit mode follows the same access as `/settings` — any authenticated user, or everyone if `auth.enabled: false`. Outside edit mode, the dashboard is unchanged and read-only, exactly as it renders today.

While editing:

- **Reorder tiles** by dragging them — within a group, or across groups (dropping a tile into another group's grid reassigns it there). Drag a group's header to reorder whole groups. Dragging uses an 8px pointer-activation threshold so taps and scrolling don't start a drag, which is also what makes it work on touch. Full keyboard support too: Tab to a tile's drag handle, press Space to pick it up, arrow keys to move it, Space again to drop.
- **Configure a tile** from its kebab menu: **Edit** opens the same service/bookmark form used elsewhere; widgets expose only the exact footprints their renderer declares, alongside **Duplicate** and **Remove**.
- **Add a tile** with the **+ Add** button — a blank service, one of the widget presets, or a bookmark group, dropped into whichever group you opened it from.
- **Manage a group** from its header kebab: rename (cascades to every member service and bookmark, and carries over the collapse state), declare it for ordering, or delete it (members become ungrouped).
- **Save or discard** from the persistent edit bar. It tracks how many top-level sections changed; **Save & exit** writes everything in a single atomic request to `settings.yaml`, **Discard** drops the staged changes and returns to the live dashboard.

The **Settings** page also checks the revision on every save. If another tab or
an external YAML edit changes the file, including comments or formatting, a
reload notice appears. Reloading discards the local draft and loads the latest
settings.

**Conflict safety:** edit mode captures the config revision when you enter. If `settings.yaml` changes on disk while you're editing — a hand edit, another tab saving first — Save is rejected instead of silently overwriting, and the edit bar shows a "changed on disk" notice with a **Reload** action to pull the new version before you try again.

## Account Recovery

Kokpit doesn't collect an email address or phone number, so password recovery works differently than most apps.

**Password length and upgrades.** Newly created or replacement passwords keep the
existing minimum-length policy and have a maximum of **72 UTF-8
bytes**, matching bcrypt's full-input boundary. The setup form, recovery reset,
shared hashing policy and emergency reset utility enforce the same maximum.
Emoji and other non-ASCII characters may occupy multiple bytes; passwords are
never normalized or silently truncated by the new-password flows.

Existing bcrypt passwords still use legacy comparison during login and current
password confirmation, so an old password longer than 72 UTF-8 bytes continues
to work within the auth request-body limit. That comparison checks only its
first 72 bytes: different suffixes can still match until the password is
deliberately replaced. Kokpit does not infer the original suffix or rehash an
accepted candidate automatically. After a successful login using an overlong
candidate, the authenticated dashboard recommends replacement through your saved
recovery code or the emergency host reset below. With 2FA, this recommendation
becomes available only after the second factor succeeds; its boolean hint stays
in server-side challenge/session metadata rather than readable JWT claims.

The separate auth JSON transport limit is 16 KiB for the entire encoded request;
it does not redefine the 72-byte new-password rule. An exceptional preexisting
password that cannot fit that request must be replaced using the host reset.

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

## Service reachability

Service dots check the service's saved launch URL from the Kokpit server. Hover the
dot or focus its tile/link to read the observed HTTP status, server-to-service
latency, and when the check completed. Escape dismisses the tooltip. For tiles
whose widget contains separate links, the dot has its own keyboard stop.

- **Reachable:** a 2xx response arrived.
- **Reachable, qualified:** a redirect, authentication requirement (401/403),
  unsupported HEAD method (405/501), or another HTTP client error arrived.
  These responses establish reachability without proving application health.
- **Reachable, degraded:** the service returned another 5xx error.
- **Unreachable from Kokpit:** a DNS, connection, TLS, or five-second probe timeout
  prevented a response. This describes Kokpit's network path to the service.
- **Status unavailable:** dashboard authentication/configuration, probe capacity,
  safety restrictions, or the checker prevented a usable observation. A hollow
  dot distinguishes this from an unreachable service; prior observations remain
  available in the tooltip.

Checks use `HEAD` only, never follow redirects, and never inject integration
credentials. A 405/501 does not trigger an automatic GET fallback. Configured LAN
destinations remain supported within the existing SSRF restrictions. Results are
shared briefly across tiles/tabs handled by the same Kokpit server process;
cached results retain their original timestamp and latency. Latency stops when response headers arrive and measures neither page
load time nor the browser's connection. This indicator does not check application
dependencies or authenticated functionality.

`POST /api/ping` accepts `{ "serviceId": "<saved service UUID>" }`, rather than a
caller-supplied URL. HTTP 200 probe envelopes retain `ok` and, for received HTTP
responses, `status`. Additive `reachable`, `assessment`, `reason`, `checkedAt`
(UTC epoch milliseconds), and `responseTimeMs` distinguish observations from
checker failures:

| `reachable` | `assessment` values | `reason` values |
| --- | --- | --- |
| `true` (`ok: true`, with `status`) | `reachable`, `redirect`, `authentication-required`, `access-restricted`, `method-unsupported`, `http-error`, `degraded` | Omitted |
| `false` (`ok: false`) | `unreachable` | `timeout`, `connection-failed`, `dns-failed` |
| `null` (`ok: false`) | `unavailable` | `capacity`, `probe-blocked`, `checker-failed` |

`ok: true` includes reachable HTTP errors. `reachable: false` means a transport
failure; `reachable: null` means no service observation was possible. Capacity,
safety and checker failures use the HTTP 200 probe envelope above; latency can be
`null` when no probe ran. Public failure reasons exclude upstream error text.

Controlled request/authentication/configuration errors instead return only
`{ "error": "<message>" }`, without `ok` or probe metadata: HTTP 400 for invalid
JSON, service IDs or launch URLs; 401 for missing/expired dashboard authorization;
404 for an unknown saved service; 409 for changing/unavailable configuration;
413 for a body exceeding 1 KiB; and 415 for a non-JSON content type. Check the HTTP
status before interpreting a response as a service observation.
Status colors use `--color-success`, `--color-warning`, `--color-error`, and
`--color-text-muted`; ordinary custom CSS can override them.

## Widgets

Saved-widget requests share successful results within each Kokpit server process.
Equivalent tiles and browser tabs use one upstream operation, with a reuse window
of at most five seconds and never longer than the requesting tile's effective
polling interval. Widgets with automatic refresh disabled share only simultaneous
work. Existing widget polling intervals and integration-specific caches remain
unchanged; the reuse window can add up to five seconds of data age.

Each request still checks the current configuration, saved tile, widget inputs
and authorization. Credentials, options, widget type and footprint keep different
requests separate. YAML changes, including comments, invalidate retained results;
an in-flight result from an older configuration is rejected rather than returned.
Session revocation is checked again before returning data. Connection tests and
authentication responses are outside this cache, and HTTP responses use
`Cache-Control: private, no-store`.

The process-local cache retains at most 256 successful results and 16 MiB of
serialized UTF-8 payloads, with a 1 MiB per-result retention limit. Larger valid
results are still returned without retention. At most 64 distinct upstream
operations run through this cache at once, including old-generation work. A hard
timeout ends consumer waits and sharing for that attempt, but its upstream slot
remains occupied until the actual load settles, even if it ignores cancellation.
Existing pending identities can still be joined, and fresh cached successes remain
available at capacity. New work receives retryable `503` / `widget_busy` with
`Retry-After: 1`; loads that never settle keep their slots rather than allowing
unbounded replacement work. Failures are not cached, and client stale-data behavior
is unchanged. These limits bound retained serialized data, not the server's total
heap usage. A tab aborting its browser request does not cancel shared work needed
by another tab. No external cache service is required, and separate server
processes have independent caches.

Widgets display live data from your self-hosted services and opt-in external APIs directly on a service tile. Each widget polls its data source on a configurable interval.

Automatic widget and service-status refreshes run only while the dashboard is
visible and the browser does not report offline. Each refresh finishes before the
next interval starts, so slow requests can complete. Failures retain the last
successful data and retry with exponential backoff and bounded jitter, capped at
five minutes (or the configured interval if longer); valid `Retry-After` guidance
is bounded too. Returning refreshes data that is due or recovering, while recent
successful data stays in place. Explicit refresh joins an active request and can
bypass failure backoff, subject to a one-second minimum retry gap. An interval of
`0` keeps its initial/manual behavior; focus or reconnect does not enable recurring
polling. Changed saved fetch inputs can still trigger one new payload.
Terminal configuration/identity failures wait for changed fetch inputs or an
explicit retry after reconciliation, so an unchanged invalid target cannot loop.

### Search

Add a **Search** tile for a native browser search form at **Wide 6×2** (default) or **Compact 3×2**. Both sizes use the same shared input/button component, caption and dashboard theme colors, with an accessible search label and keyboard submission. Select the footprint in the editor, or set `columnSpan: 3` for Compact in YAML. Existing Wide tiles retain their size. The default engine is DuckDuckGo. Searches go directly from the browser to the configured endpoint; there are no suggestions, engine polling or search-history storage in the widget.

Configure the **Search URL** and **Query parameter** (default `q`). Use `https://www.google.com/search` for Google or your SearXNG instance's `/search` endpoint. Other HTTP(S) engines work when they accept a GET query parameter. Existing fixed URL parameters, including repeated values, are preserved; existing values of the query parameter are replaced by the typed query. Supply the endpoint URL, without a `{query}` template. Embedded URL credentials and fragments are rejected. A self-hosted endpoint must be reachable from your browser; Kokpit does not proxy searches.

**Engine name** is an optional display label. Otherwise the widget shows DuckDuckGo, Google or the endpoint host. **Open results in a new tab** defaults to enabled; results tabs have no opener or referrer. Search text is trimmed, blank queries are blocked, and the browser encodes special characters. Each tile loads its saved engine options once; automatic widget refresh is disabled by default.

```yaml
services:
  - id: "10000000-0000-4000-8000-000000000001"
    name: Search
    icon: /icons/search.svg
service_tiles:
  - id: "20000000-0000-4000-8000-000000000001"
    service_id: "10000000-0000-4000-8000-000000000001"
    footprint: { columnSpan: 6, rowSpan: 2 }
    widget:
      type: search
      config:
        search_url: https://search.example.com/search?language=en
        query_parameter: q
        engine_name: SearXNG
        new_tab: true
```

No service integration or API key is required. Saving validates the endpoint format; the browser contacts it when you submit a query. Search has no connection-test action. Engine settings are public tile options, so do not put tokens or other secrets in the search URL. The tile can also have an independent service launch URL; only its header becomes a link, leaving the search controls accessible.

### Calendar

Add a **Calendar** tile for a read-only upcoming agenda. Both **Agenda (3×4)** and **Detailed (6×4)** keep the same configured events, ordered by start time, with keyboard scrolling. Detailed adds location and description. Date badges use the shared informational color; times use the tile's time zone. All-day dates retain their original day and show the inclusive last day of a multi-day event. Tentative and in-progress events are explicitly labeled.

The reusable **Calendar** service connection accepts either:

- A **CalDAV collection URL**, such as `https://cloud.example.com/remote.php/dav/calendars/me/personal/`. Use the calendar collection itself, not a discovery/account URL or an ICS download link. Enter both **CalDAV username** and **CalDAV password**, or leave both empty for an unauthenticated collection. App passwords are recommended where supported. LAN collections are supported. Only read-only `REPORT` queries are sent; there is no event creation or editing.
- A **public Google calendar ID**, usually an email address such as `example@group.calendar.google.com`, plus a **Google API key** with Google Calendar API enabled. Find the ID under Google Calendar **Settings → Integrate calendar**. API-key access requires the calendar to be public; private calendars and OAuth login are outside this widget's scope. Leave CalDAV credentials empty. Requests use Google's fixed HTTPS endpoint; the key is sent in a header.

Credentials remain server-side and are bound to the calendar destination. Calendar requests do not follow redirects: use the collection's final URL so credentials cannot be forwarded to another destination. HTTP(S) collection URLs with embedded credentials or fragments are rejected. Prefer HTTPS for calendars carrying credentials.

Each tile configures **Days ahead** (1–30, default 7), **Event limit** (1–50, default 10), and an IANA **Time zone** (default `UTC`, for example `Europe/Warsaw`). The window starts at the last fetch and extends by that many 24-hour periods; ongoing events are included. Floating CalDAV times use the calendar's `X-WR-TIMEZONE`, including a custom zone backed by an embedded definition, or the tile's time zone when absent. RRULE meetings, explicit RDATE dates, excluded dates, moved instances and cancellations are handled server-side. RDATE periods (a start plus duration/end) and recurrence ranges (`THISANDFUTURE`) are currently unsupported and produce an error rather than an incomplete or outdated agenda. All-day end dates are exclusive in the source and rendered inclusively.

```yaml
services:
  - id: "10000000-0000-4000-8000-000000000001"
    name: Calendar
    icon: /icons/calendar.svg
    integration:
      type: calendar
      config:
        calendar: https://cloud.example.com/remote.php/dav/calendars/me/personal/
        username: me
        password: your-app-password
service_tiles:
  - id: "20000000-0000-4000-8000-000000000001"
    service_id: "10000000-0000-4000-8000-000000000001"
    footprint: { columnSpan: 6, rowSpan: 4 }
    widget:
      type: calendar
      config:
        days_ahead: 7
        max_items: 10
        timezone: Europe/Warsaw
```

Refreshes every five minutes, with a fifteen-second fetch deadline for slow or paginated providers. A valid empty calendar shows “No upcoming events”; refresh errors retain the last event list and scroll position with the shared warning. Each response is bounded to 2 MiB of UTF-8 data; CalDAV XML rejects DTDs and excessive nesting. Synchronous iCalendar parsing/expansion runs in a worker with a two-second budget, a memory cap, a 5,000-instance cap, and at most four active parsers. Unreadable or excessive responses show an error instead of a misleading partial agenda. Calendar text is rendered as text, and only HTTP(S) event links are clickable.

### Hermes AI agent

Add a **Hermes Overview** tile and enter the **API server URL** (for example,
`http://hermes:8642`) and **API server key** (`API_SERVER_KEY`). Enable Hermes's
API listener with `API_SERVER_ENABLED=true` and start its gateway. Kokpit must be
able to reach that listener from its own container; `localhost` refers to the
Kokpit container. A reverse-proxy base path or Hermes `/p/<profile>` prefix is
preserved. Use the listener root, rather than appending `/v1`.

Default **3×4** and Wide **6×3** show readiness, active **API** runs, the next
scheduled job and its last result, up to ten recent sessions, scheduled-job count
and the number of jobs with failed results, blocked configuration or scheduling
errors. Delivery failures count too; pausing a job alone does not count as failure.
Times are UTC. Sessions are sorted by activity; a still-open session
is not assumed to be running. The active-run count covers the API listener, not
all CLI or messaging work. Metadata is fetched every 30 seconds; prompts,
transcript previews, raw errors and the API key are never returned with widget
data. Long titles retain their full normalized text in tooltips, and the activity
list supports keyboard scrolling while the summary remains fixed. Wide arranges
activity in two columns within the same scroll region.

Set the service **launch URL** to your Hermes web dashboard for the tile's open
link; it is independent of the API connection URL. The first version is read-only.
Upcoming work includes enabled, scheduled jobs; running, paused and terminal jobs
are excluded.
Missing job/session endpoints are labeled unsupported; transient section errors
are labeled unavailable. Older listeners without detailed health fall back to
Online, with an unknown active-run count. Online establishes liveness, while
Ready requires a successful readiness report. Failed refreshes retain the last
complete snapshot with a stale notice.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000010
    name: Hermes
    launch_url: https://hermes.example.com
    icon: /icons/hermes.svg
    integration:
      type: hermes
      config:
        url: http://hermes:8642
        api_key: your-api-server-key
service_tiles:
  - id: 20000000-0000-4000-8000-000000000010
    service_id: 10000000-0000-4000-8000-000000000010
    footprint: { columnSpan: 3, rowSpan: 4 }
    widget:
      type: hermes-overview
```

The credential stays in server-side settings and is scoped to the saved API URL.
Requests use validated LAN/VPN destinations and never follow redirects with the
bearer token. See [Hermes API setup](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server).

### RSS / Atom

Add an **RSS / Atom** tile from the editor and enter a public **Feed URL**. **Article limit** accepts 1–50 (default 10). Each tile keeps its own URL and limit; no service integration or API key is required. RSS 2.0, RSS 1.0/RDF and Atom feeds are supported.

Compact **3×3** and Wide **6×3** show headlines and publication dates; Detailed **6×4** adds plain-text summaries; binary Atom bodies are omitted. Every size retains the configured articles in feed order and uses a named, keyboard-scrollable list. Home/End reach the first/last article while the feed name and count stay fixed. Truncated headlines retain their full accessible link text and title tooltip. Publication dates use UTC and include the year; missing dates display “Date unavailable”. Articles without safe HTTP(S) links remain text. Article links open in a new tab; an optional service launch URL links only the tile header.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000001
    name: Reading
service_tiles:
  - id: 20000000-0000-4000-8000-000000000001
    service_id: 10000000-0000-4000-8000-000000000001
    footprint: { columnSpan: 6, rowSpan: 4 }
    widget:
      type: rss
      config:
        feed_url: https://example.com/feed.xml
        max_items: 10
```

Feeds are fetched server-side every ten minutes by default, including when the browser cannot access them due to CORS. Every redirect destination is DNS-validated and pinned; private networks, metadata endpoints and embedded URL credentials are unsupported. Responses are limited to 2 MiB of UTF-8 XML; DTD/entity declarations are rejected, and nesting beyond 40 elements is rejected before DOM allocation. Common HTML named entities are supported in ordinary XML text while literal sections stay intact. Markup is parsed into inert text nodes, preserving escaped comparison signs and separating paragraphs; scripts/styles are omitted and feed HTML never executes in the dashboard. Text extraction processes at most 65,536 UTF-16 code units from each field, with 200-character feed titles and 500-character article titles/summaries. Empty or invalid summary/date fields try later alternatives. Safe RSS permalink GUIDs provide article links when a link is absent. A valid empty feed shows “No articles in this feed”; refresh errors preserve saved articles and scroll position with the shared notice. Each open tile polls independently; no request is made until a feed is configured.

### Weather (Open-Meteo)

Current conditions and a five-day forecast, with no API key. Add or edit a **Weather** tile from the dashboard editor, enter latitude/longitude or click **Use my location**, and use the tile name for your location. Enable **Use imperial units** for Fahrenheit/mph; the default is Celsius/km/h. Location, units and footprint belong to each tile; no reusable service integration or launch URL is required.

**Use my location** asks your browser for this device's location once, only when clicked. It requires HTTPS (or localhost) and browser permission. Coordinates are rounded to three decimal places (roughly 100 m), filled into the editable fields and saved to `settings.yaml` through the normal tile/dashboard save flow. All viewers of that tile see weather for the saved location; it does not track movement or detect each viewer automatically. The browser may use its own location provider; Kokpit performs no IP lookup or city search. Denied permission, unavailable location or a timeout leaves existing coordinates intact, with manual entry always available. Editing coordinates, switching tile type or closing the form prevents a pending result from changing the configuration.

Finding a position can take up to a minute after permission is granted. **Cancel location detection** stops waiting and ignores any late result, so you can retry or enter coordinates manually. Permission prompts do not count against the browser's position-acquisition timeout.

On Windows 11, Chrome can require [both website permission and Windows location permission](https://developer.chrome.com/blog/changes-location-permissions-windows). If detection times out despite allowing the site, open **Windows Settings → Privacy & security → Location**, enable **Location services**, and allow location access for apps and desktop apps where those controls are shown. Accept Chrome's separate Windows permission prompt if one appears. [Microsoft's location settings guide](https://support.microsoft.com/en-us/windows/privacy/windows-location-service-and-privacy) also explains how to set a default location for desktops without Wi-Fi. Kokpit cannot determine a location while the browser or operating system's location provider is unavailable; manual tile coordinates remain available.

Compact **3×2** shows Temperature / Conditions. Wide **6×2** adds Feels like. Detailed **6×4** adds Humidity / Wind / dated precipitation and a named, keyboard-scrollable five-day forecast with low/high temperatures, conditions and precipitation probability. The summary and attribution stay fixed while the forecast scrolls. Times/dates come from the location's timezone; the attribution link's tooltip gives the observation time and timezone. Missing values display “—”, unknown condition codes display “Unknown”, and a missing forecast retains current conditions. Forecast temperature/probability values with missing or unexpected units stay unavailable. With an optional service URL, the header launches that service and attribution remains a separate link.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000001
    name: London weather
service_tiles:
  - id: 20000000-0000-4000-8000-000000000001
    service_id: 10000000-0000-4000-8000-000000000001
    footprint: { columnSpan: 6, rowSpan: 4 }
    widget:
      type: weather
      config:
        latitude: 51.5074
        longitude: -0.1278
        imperial: false
```

Latitude is required (−90…90), as is longitude (−180…180); `imperial` is optional. The server makes one HTTPS request to the fixed Open-Meteo endpoint per fetch and refreshes every ten minutes by default. Each open tile polls independently; any configured shorter refresh override increases requests. A refresh failure preserves saved data with an accessible notice. Setting coordinates opts that tile into the external weather service and sends those coordinates to Open-Meteo for forecasts.

Weather data: [Open-Meteo](https://open-meteo.com/), [CC BY 4.0](https://open-meteo.com/en/licence). Its [free API terms](https://open-meteo.com/en/terms) apply, including non-commercial use and request limits. OpenWeatherMap is a separate future provider, not implemented by this widget.

### Configuring service-backed widgets

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

Connection credentials belong in `services[].integration.config`; tile-specific
display options belong in `service_tiles[].widget.config`. Credentials are read
server-side only and are never sent to the browser.

**Integration URLs and redirects:** configure the final HTTP(S) service URL,
including the correct scheme, port and reverse-proxy base path. Plex, Tautulli,
Sonarr, Radarr, Prowlarr, qBittorrent, SABnzbd, Seerr, Immich, Netdata, Unraid,
Tdarr and Actual Budget keep credential-bearing requests on that configured
origin (scheme, host and port). GET/HEAD requests can follow up to five
same-origin redirects, such as trailing-slash canonicalization. Cross-origin
redirects, including HTTP-to-HTTPS upgrades, are blocked before contacting the
destination. URLs with embedded usernames/passwords are rejected; use the
integration's credential fields. Login and other requests with bodies do not
follow redirects, even within the same origin, so configure their final
endpoint directly. Private LAN service URLs remain supported. Calendar and
Hermes retain their stricter no-redirect policies; Weather, RSS and icon
discovery retain their separate transport rules.

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
| `fields` | No       | Explicit non-empty list of stats; overrides size defaults |
| `size_defaults` | No | Use 2/3/6/10 default stats by footprint; enabled for new editor tiles |


**Available display fields:**


| Value              | Label       | Description                                 |
| ------------------ | ----------- | ------------------------------------------- |
| `streams`          | Streaming   | Total active sessions                       |
| `transcodes`       | Transcoding | Sessions currently being transcoded         |
| `lan_streams`      | LAN         | Active sessions on the local network        |
| `remote_streams`   | Remote      | Active sessions over the internet           |
| `users`            | Users       | Number of distinct users currently watching |
| `bandwidth`        | Bandwidth   | Total streaming bandwidth (Mbps, Gbps or Tbps)   |
| `library_movies`   | Movies      | Total movies across all movie libraries     |
| `library_shows`    | Shows       | Total shows across all TV libraries         |
| `library_episodes` | Episodes    | Total episodes across all TV libraries      |
| `library_music`    | Music       | Total albums across all music libraries     |


The widget contacts `/status/sessions` for session measurements and the Detailed playing list, and `/library/sections` for selected library measurements.

Plex supports **Compact (3×2)**, **Wide (6×2)**, **Detailed (3×4)** and
**Expanded (6×4)**. New editor tiles start compact with `size_defaults: true`:
Compact shows Streaming / Transcoding; Wide adds Bandwidth; Detailed shows all
six session measurements above a playing list using the same shared rows,
playback badges and progress bars as Tautulli; Expanded adds Movies / Shows /
Episodes / Music.
Explicit `fields` always take priority, and selections too large for a smaller
canvas remain reachable in a named keyboard-scroll region. Existing tiles keep
their saved footprint and fields. Without `size_defaults: true`, omitted fields
retain the historical Streaming / Transcoding selection; older tiles without
fixed geometry retain their wide canvas. Bandwidth promotes to Gbps/Tbps for
large values.

Detailed uses the same `/status/sessions` response for its stats and session
list. Each row shows the media title, user, media/transcode mode, playback state
and progress; missing duration/offset is shown as unknown progress. All selected
stats remain visible: custom selections with more than six measurements scroll
with the sessions. Playback data is projected server-side; emails, device/IP
identifiers and media file paths are not returned to the browser.

---

### Tautulli

Displays current Plex activity from Tautulli.

**Prerequisites:** Connect Tautulli to Plex first. Sign in as an administrator and open **Settings → Web Interface → Enable API**. Enable it if needed, reveal **API key** with the eye icon, then click the field to select and copy its value. If empty, click **Generate**. Save Tautulli's settings before using the key in Kokpit; a replacement affects other connected apps.

Add/Edit Service includes a numbered guide, field help, troubleshooting and the shared outdated-instructions/GitHub-issue notice. Enter Tautulli's base URL (usually port 8181), retaining any **HTTP Root** from **Show Advanced → Web Interface**. Kokpit normalizes a final slash, appends `/api/v2`, and requests `get_activity`; omit the endpoint and query string from the field. Use **Test connection** when enabled, then save; otherwise save and check the dashboard.

The key also permits commands that change data, although this widget only reads activity. Prefer a private connection; for remote access use HTTPS and enable Tautulli authentication. Kokpit currently sends `apikey` as a query parameter, so keep full request URLs private. The official [API reference](https://github.com/Tautulli/Tautulli/wiki/Tautulli-API-Reference) documents that method and the header alternative available in Tautulli 2.18.0+. See the official [FAQ](https://github.com/Tautulli/Tautulli/wiki/Frequently-Asked-Questions) for network and proxy setup.

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
| `url` | Yes | Tautulli base URL including protocol, port and any HTTP Root, reachable from Kokpit; omit `/api/v2` and query parameters |
| `api_key` | Yes | Application API key from Settings → Web Interface, rather than a Plex or mobile-device token; leave a saved value unchanged to retain it |
| `sections` | No | `summary` shows the five aggregate activity measurements; `sessions` shows per-user playback/progress. Defaults to both; at least one is required |

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

Tautulli supports **Default (3×4)** and **Expanded (6×4)**. Both show only the selected sections.
With Summary selected, Default uses three columns and Expanded puts all five measurements in one row.
With Active sessions selected, every returned session appears in a list that scrolls by mouse or keyboard.
When both are selected, Summary stays fixed above the session list. Playing uses green,
buffering amber, failures red, and paused/unknown states neutral shared tones.
The default refresh is 10 seconds. Editor overrides use milliseconds with a 5-second minimum. This is current activity, not watch history; an empty session list is normal when nobody is streaming.


---

### Sonarr

Two widgets are available for Sonarr: a calendar showing upcoming episodes and a download queue monitor.

**Prerequisites:** A Sonarr instance reachable from Kokpit and its API key. Sign in to Sonarr, open **Settings → General → Security**, and copy the existing **API Key**. Paste only the key into Kokpit; resetting it affects other apps that use it.

The Add/Edit Service form includes a shared step-by-step guide for Calendar and Queue, help under each field, troubleshooting, and an [official Sonarr settings reference](https://wiki.servarr.com/sonarr/settings#general). Enter the base URL (usually port 8989), including any configured URL Base **with a trailing slash**, for example `https://example.com/sonarr/`. Kokpit appends `/api/v3` and sends the key in `X-Api-Key`, as documented in the [Sonarr API](https://sonarr.tv/docs/api/). Use **Test connection** when enabled, then save; otherwise save and check the dashboard.

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
| `url`     | Yes      | Reachable Sonarr base URL; include any URL Base and end it with `/` |
| `api_key` | Yes      | Existing API Key from Settings → General → Security |
| `days`    | No       | Whole days in the window starting today at 00:00 UTC (1–30, default: 7 when omitted/blank in the editor); Calendar only |

The Default footprint is 3×4, with a scrolling episode list. The default refresh interval is 60 seconds; an editor override is in milliseconds (minimum 5,000).


#### `sonarr-queue`

Shows the first page of up to 25 queue entries with progress bars, status, and ETA. Downloads without a known Sonarr series are excluded. There is no configurable queue limit or Calendar date-window filter.

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
| `url`     | Yes      | Reachable Sonarr base URL; include any URL Base and end it with `/` |
| `api_key` | Yes      | Existing API Key from Settings → General → Security |

The Default footprint is 3×4, with a scrolling queue. The default refresh interval is 15 seconds; an editor override is in milliseconds (minimum 5,000).


---

### Radarr

Two widgets are available for Radarr: a stats overview and a download queue monitor.

**Prerequisites:** A Radarr instance reachable from Kokpit and its API key. Sign in to Radarr, open **Settings → General → Security**, and copy the existing **API Key**. Paste only the key into Kokpit; resetting it affects other apps that use it.

Stats and Queue share the Add/Edit Service form's numbered setup guide, field help, troubleshooting, and outdated-instructions issue link. Enter the base URL (usually port 7878), including any configured URL Base. A path such as `https://example.com/radarr/` **requires a trailing slash**; a root URL such as `http://192.168.1.10:7878` works with or without one. Kokpit appends `/api/v3` and sends the key in `X-Api-Key`. Use **Test connection** when enabled, then save; otherwise save and check the dashboard. See the [official Radarr settings](https://wiki.servarr.com/radarr/settings#general) and [API reference](https://radarr.video/docs/api/).

#### `radarr-stats`

Displays six shared stat cards showing the state of your movie library. New tiles default to a two-column, three-row 3×4 layout; existing 6×2 tiles keep all six metrics in one row. Positive Missing counts are red, Wanted/Queued are amber when non-zero, Available is green, and Upcoming/Total are informational blue. Refresh failures retain saved data and show a separate warning without moving the cards.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000024
    name: Radarr
    launch_url: http://192.168.1.10:7878
    icon: radarr
    integration:
      type: radarr
      config:
        url: http://192.168.1.10:7878/
        api_key: YOUR_API_KEY
service_tiles:
  - id: 20000000-0000-4000-8000-000000000024
    service_id: 10000000-0000-4000-8000-000000000024
    widget:
      type: radarr-stats
```


| Field     | Required | Description                              |
| --------- | -------- | ---------------------------------------- |
| `url`     | Yes      | Reachable Radarr base URL; include any URL Base path with a trailing `/` (optional at the root) |
| `api_key` | Yes      | Existing API Key from Settings → General → Security |

Detailed (3×4) shows the six metrics in two columns and three rows; Wide (6×2) shows the same metrics in one row. The default refresh interval is 60 seconds; an editor override is in milliseconds (minimum 5,000).


**Displayed stats:**


| Stat      | Description                                               |
| --------- | --------------------------------------------------------- |
| Missing   | Monitored movies without a file that Radarr marks available (`isAvailable`) |
| Upcoming  | Movies in "announced" or "in cinemas" status              |
| Wanted    | All monitored movies without a file                       |
| Queued    | Total items currently in the download queue               |
| Available | Movies with a downloaded file                             |
| Total     | All movies tracked in Radarr                              |


#### `radarr-queue`

Shows the first page of up to 25 known-movie queue entries with progress bars, status, and ETA. Downloads without a known Radarr movie are excluded; there is no configurable queue limit. Stats uses Radarr's reported queue total, which can exceed the number of displayed entries.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000025
    name: Radarr
    launch_url: http://192.168.1.10:7878
    icon: radarr
    integration:
      type: radarr
      config:
        url: http://192.168.1.10:7878/
        api_key: YOUR_API_KEY
service_tiles:
  - id: 20000000-0000-4000-8000-000000000025
    service_id: 10000000-0000-4000-8000-000000000025
    widget:
      type: radarr-queue
```


| Field     | Required | Description                              |
| --------- | -------- | ---------------------------------------- |
| `url`     | Yes      | Reachable Radarr base URL; include any URL Base path with a trailing `/` (optional at the root) |
| `api_key` | Yes      | Existing API Key from Settings → General → Security |

The Default footprint is 3×4, with a scrolling queue. The default refresh interval is 15 seconds; an editor override is in milliseconds (minimum 5,000).


---

### Prowlarr

Displays indexer health, protocol counts and retained grab-history totals from Prowlarr.

**Prerequisites:** A Prowlarr instance reachable from Kokpit and its application API key. Open **Settings → General → Security**, copy the existing **API Key**, and paste only that key into Kokpit. An indexer provider's key or a Sonarr/Radarr key will not work. Resetting Prowlarr's key affects other connected apps too.

The Add/Edit Service form includes numbered instructions, field help, troubleshooting and the shared outdated-instructions/GitHub-issue link. Enter Prowlarr's base URL (usually port 9696). Include any configured URL Base path **with a trailing slash**, such as `https://example.com/prowlarr/`; a root URL works with or without one. Kokpit adds `/api/v1` and sends the key in `X-Api-Key`. Use **Test connection** when enabled, then save; otherwise save and check the dashboard. See the [official settings documentation](https://wiki.servarr.com/prowlarr/settings#general) and [API reference](https://prowlarr.com/docs/api/).

#### `prowlarr-stats`

Shows six shared stat cards in a two-column, three-row grid at 3×4: Enabled / Failing on top, Indexers / Total Grabs in the middle, and Usenet / Torrent on the bottom. Failing indexers are highlighted in red when non-zero. Protocol counts include enabled and disabled indexers and come from the existing indexer request. Refresh failures retain the last data and show a separate warning without moving the cards.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000026
    name: Prowlarr
    launch_url: http://192.168.1.10:9696
    icon: prowlarr
    integration:
      type: prowlarr
      config:
        url: http://192.168.1.10:9696/
        api_key: YOUR_API_KEY
service_tiles:
  - id: 20000000-0000-4000-8000-000000000026
    service_id: 10000000-0000-4000-8000-000000000026
    widget:
      type: prowlarr-stats
```


| Field     | Required | Description                                |
| --------- | -------- | ------------------------------------------ |
| `url`     | Yes      | Reachable Prowlarr base URL; include any URL Base path with a trailing `/` (optional at the root) |
| `api_key` | Yes      | Prowlarr's own API Key from Settings → General → Security |

The Default footprint is 3×4, with two columns and three rows of stats. The default refresh interval is 60 seconds; an editor override is in milliseconds (minimum 5,000).


**Displayed stats:**


| Stat        | Description                                                  |
| ----------- | ------------------------------------------------------------ |
| Enabled     | Indexers currently enabled                                   |
| Failing     | Indexers with an active error status (shown in red when > 0) |
| Indexers    | Total number of configured indexers                          |
| Total Grabs | Retained release-grab history events (`eventType=1`); excludes query/authentication events and is not a permanent lifetime total |
| Usenet      | Configured Usenet indexers, including disabled indexers       |
| Torrent     | Configured Torrent indexers, including disabled indexers      |


---

### qBittorrent

Two widgets are available for qBittorrent: a transfer stats overview and a live torrent list.

**Prerequisites:** WebUI enabled (Options → Web UI) with a username and password — the widget authenticates via qBittorrent's `auth/login` endpoint, so "Bypass authentication for clients on localhost" alone is not enough.

#### `qbittorrent-stats`

Displays current download/upload speed. The compact 3×2 tile shows only the two
speeds. The 3×4 tile uses three rows of the same stat cards: download/upload
speeds, downloaded/uploaded totals, then Active and Inactive torrent counts. The 6×2 tile
shows the four speed and total values in one row. New tiles created in the editor default to 3×2;
existing 6×2 tiles remain supported.

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
    footprint: { columnSpan: 3, rowSpan: 2 }
    widget:
      type: qbittorrent-stats
```


| Field      | Required | Description                     |
| ---------- | -------- | -------------------------------- |
| `url`      | Yes      | Base URL of your qBittorrent WebUI |
| `username` | Yes      | WebUI username                   |
| `password` | Yes      | WebUI password                   |


**Displayed stats:** download speed and upload speed at every size; total downloaded
and total uploaded at 3×4 and 6×2. At 3×4, Inactive counts queued and stopped
torrents (including the older `pausedDL`/`pausedUP` names); Active counts all other
torrents returned by qBittorrent, including stalled, checking, error, and missing-file states.
These are dashboard categories; qBittorrent's own "inactive" filter means zero current transfer speed.
If activity cannot be fetched, the transfer values
remain visible and the tile says "Activity unavailable."

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

Uses the same shared cards and size progression as the other migrated widgets:

- **3×2 compact (default):** download speed and queue count.
- **6×2 wide:** download speed, queue count, and total queue size; existing wide tiles remain supported.
- **3×4 detailed:** Speed / Queue, Queue Size / Remaining, and ETA / Status in a two-column, three-row grid. Remaining size, ETA, and status come from the existing queue response, with no additional request. Missing optional details show “—” while retaining the summary data.

Download speed is green, positive queue counts amber (neutral when empty), and size/ETA values informational blue. Status uses the reported download state: active work green, paused/idle/stopped neutral, queued work amber, explicit errors red, and other reported states blue. An empty queue has no ETA. Refresh failures preserve the last data and show a separate warning without moving the cards.

**Prerequisites:** A SABnzbd instance reachable from Kokpit and its full **API Key**. Open **Config → General → Security**, click the API Key field to select its text, then copy and paste that value into Kokpit. The separate **NZB Key** only adds jobs and cannot read queue data. Changing the API Key requires updating other connected apps too.

The Add/Edit Service form includes a numbered guide, field help, troubleshooting and the common outdated-instructions/GitHub-issue link. Enter SABnzbd's base URL (usually port 8080), retaining any reverse-proxy prefix; omit `/api` and query parameters. Kokpit builds the queue request and adds the key automatically. Use **Test connection** when enabled, then save; otherwise save and check the dashboard. See [SABnzbd General settings](https://sabnzbd.org/wiki/configuration/5.1/general) and the [official API reference](https://sabnzbd.org/wiki/advanced/api).

If SABnzbd refuses a custom hostname, its [hostname verification guide](https://sabnzbd.org/wiki/extra/hostname-check.html) explains adding the expected hostname to **Config → Special → host_whitelist**. Prefer a private network connection. If external access is needed, use HTTPS and restrict access to trusted clients. **External internet access → API (no config)** permits the queue request, history access, and adding/removing jobs; it is not a read-only permission. Kokpit sends the API key as a query parameter. This widget only reads the queue and does not need configuration API access.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000029
    name: SABnzbd
    launch_url: http://192.168.1.10:8080
    icon: sabnzbd
    integration:
      type: sabnzbd
      config:
        url: http://192.168.1.10:8080/
        apikey: YOUR_API_KEY
service_tiles:
  - id: 20000000-0000-4000-8000-000000000029
    service_id: 10000000-0000-4000-8000-000000000029
    widget:
      type: sabnzbd
```


| Field    | Required | Description                        |
| -------- | -------- | ----------------------------------- |
| `url`    | Yes      | Reachable SABnzbd base URL, including any reverse-proxy prefix; omit `/api` and query parameters |
| `apikey` | Yes      | Full API Key from Config → General → Security; NZB Key cannot read the queue |

The default refresh interval is 10 seconds; an editor override is in milliseconds (minimum 5,000). The widget makes one `mode=queue` request for every footprint and does not fetch download history.


**Displayed stats:** download speed and queue item count; wide/detailed views add total queue size, and detailed adds remaining size, estimated time left and download status.

---

### Seerr

Two widgets are available for Seerr. Both are also compatible with Jellyseerr and Overseerr, which share the same API.

**Prerequisites:** Complete the application's initial setup, then sign in as an administrator and open **Settings → General → API Key**. Use the copy button beside the existing key and paste only its value into Kokpit. This key grants administrator access, although Kokpit only reads requests; keep it private and use a trusted network or HTTPS. Regenerating the key affects other connected apps. It is not a Plex/Jellyfin token or a Sonarr/Radarr key.

Both widgets include the numbered setup guide, field help, troubleshooting and the shared outdated-instructions/GitHub-issue notice in Add/Edit Service. Enter the instance's base address, usually port 5055, without `/api/v1`; Kokpit appends the API path and sends `X-Api-Key`. Prefer the root address or a reverse-proxy subdomain: Seerr does not officially support subfolder base URLs. Use **Test connection** when enabled, then save; otherwise save and check the dashboard. See the official [General settings](https://docs.seerr.dev/using-seerr/settings/general/), [API authentication](https://docs.seerr.dev/api/seerr-api/) and [reverse-proxy guide](https://docs.seerr.dev/extending-seerr/reverse-proxy/).

#### `seerr-stats`

Summarises media requests using shared stat cards and theme-aware colors.

| Size | Footprint | Stats |
| --- | --- | --- |
| Compact (default) | 3×2 | Pending / Available |
| Wide | 6×2 | Pending / Available / Total |
| Detailed | 3×4 | Pending / Approved / Available / Total |

Pending uses amber when positive, Available green when positive, and Approved/Total informational blue. Zero pending/available counts are neutral. Detailed retains all four API metrics. Existing wide tiles, missing geometry and unsupported legacy footprints retain 6×2; supported saved geometry remains intact. A reserved warning row keeps cards stationary after refresh failures.

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
| `url`     | Yes      | Seerr/Jellyseerr/Overseerr root address or proxy subdomain, including protocol and port (usually 5055), reachable from Kokpit; omit `/api/v1` |
| `api_key` | Yes      | Administrator API Key from Settings → General; leave a saved value unchanged to retain it |


**Displayed stats:**


| Stat      | Description                                        |
| --------- | -------------------------------------------------- |
| Pending   | Requests awaiting approval                         |
| Approved  | Count returned by the application's `approved` request filter |
| Available | Count returned by its `available` request filter    |
| Total     | All requests regardless of status                  |


#### `seerr-requests`

Shows up to 15 most recently submitted requests in a shared, keyboard-scrollable list at 3×4. The request uses `take=15`, `sort=added` and `filter=all`; the limit, newest-first order and all-status filter are fixed. Each row displays a status badge, a media type badge (movie / tv), the title with requested seasons, the requester's name, and a relative timestamp. Long titles and requester names retain their complete text for assistive technology and in tooltips. If an older API response omits a title, Kokpit fetches the movie/TV details; a failed lookup falls back to `(Movie)` or `(Show)`.

Status colors match the shared library: pending amber, approved blue, available green, failed red, declined neutral. Both media categories use informational blue. A reserved warning row preserves the list's position and scroll offset on refresh failure, including when the last saved result contains no requests. Both Seerr widgets refresh every 60 seconds.

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
| `url`     | Yes      | Seerr/Jellyseerr/Overseerr root address or proxy subdomain, including protocol and port (usually 5055), reachable from Kokpit; omit `/api/v1` |
| `api_key` | Yes      | Administrator API Key from Settings → General; leave a saved value unchanged to retain it |


A request whose media has become fully available is shown with an **available** badge regardless of its underlying request status.

---

### Immich

Shows global Immich media and storage stats for your instance.

**Prerequisites:** A reachable Immich server and an **administrator’s** API key with **`server.statistics`** permission. Sign in as an administrator, open the profile icon → **Account Settings → API Keys**, click **New API Key**, name it Kokpit, select only `server.statistics`, and click **Create**. Click **Copy to Clipboard** before closing: the secret is shown only once. Paste the secret itself into Kokpit, without `Bearer` or quotation marks. This widget does not need `server.storage` or all permissions. Keep the key private and use private networking or HTTPS.

Add/Edit Service includes numbered instructions, field help, troubleshooting and the shared outdated-instructions/GitHub-issue notice. Enter the server root or a single `/api` suffix, such as `http://immich.local:2283/api`. Kokpit normalizes the suffix and requests `GET /api/server/statistics` with the `X-Api-Key` header; omit the full statistics route and query parameters. Immich requires a domain or subdomain root and does **not** support an `/immich` subfolder. Use **Test connection** when enabled, then save; otherwise save and check the dashboard. See the official [user settings](https://docs.immich.app/features/user-settings/), [API documentation](https://api.immich.app/), [server statistics](https://docs.immich.app/administration/server-stats/) and [reverse-proxy guide](https://docs.immich.app/administration/reverse-proxy/).

#### `immich-stats`

Displays total storage usage and the combined number of photos and videos in a fixed 3×2 tile. The former 6×2 option is removed; existing wide tiles use the supported 3×2 size. A reserved warning row keeps the stats stationary if a refresh fails while saved data remains visible.

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
| `url`     | Yes      | Server root or API base ending in a single `/api`, including protocol and published port (normally 2283), reachable from Kokpit; no subfolder or full statistics route |
| `api_key` | Yes      | Administrator-owned API key with `server.statistics` permission; copy the one-time secret from Account Settings → API Keys |



| Stat    | Description                          |
| ------- | ------------------------------------ |
| Storage | Instance-wide media usage reported by the statistics endpoint, formatted in decimal B/KB/MB/GB/TB; not disk capacity or free space, and excludes external-library file usage |
| Items   | Sum of the instance-wide photo and video counts returned by Immich; not just the key owner's library |

The default refresh is 60 seconds; editor overrides use milliseconds with a 5-second minimum. There are no per-user or metric-selection options. Counts and usage follow the installed Immich version's server-statistics rules. A regular user's key cannot access this administrator-only endpoint. Rotating or deleting the upstream key invalidates it; update the saved Kokpit credential too.

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

**Prerequisites:** Unraid 7.2+ includes the API; earlier versions need the Unraid Connect plugin (no Connect login is needed for local API access). In **Settings → Management Access → API Keys**, create a key named **Kokpit** with `READ_ANY` permissions for `ARRAY` and `VARS`. Copy the key into the editor without a `Bearer` prefix. Unraid's GraphQL API must be reachable from the Kokpit container.

The Add/Edit Service form includes a numbered setup guide, help under each connection field, and expandable troubleshooting. Enter the server's base URL, then use **Test connection** and save. The developer GraphQL Sandbox is optional. See the [setup guidance proposal](docs/integration-setup-guidance-proposal.md) for the pilot and per-widget rollout plan, and [Unraid's API documentation](https://docs.unraid.net/API/how-to-use-the-api/) for upstream settings.

#### `unraid-stats`

New editor tiles start at **Compact (3×2)**. Shared cards use the same 2/3/6 progression as the other stat widgets:

| Footprint | Stats |
| --- | --- |
| Compact (3×2) | Array, Used / total storage |
| Wide (6×2) | Array, Used / total storage, Errors |
| Detailed (3×4) | Array / Used, Disks / Errors, Parity / Parity Errors |

Existing large **6×4** tiles retain their saved canvas and show all six measurements. Legacy configurations without valid geometry retain 6×4. Storage stays in binary B/KiB/MiB/GiB/TiB units with its used percentage and total; parity retains its reported date. Missing parity measurements show “—”, separately from zero errors. The Array card shows the array state. Compact/Wide add a short “Needs attention” indicator for reported problems, with the disk/parity counts available on hover or keyboard focus; Detailed keeps those counts in the dedicated error cards. Active arrays are green, storage/inventory blue, positive errors red, and stopped/unknown or missing states neutral. A running parity check is amber. Successful data stays visible with a separate refresh warning; polling remains 30 seconds.

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
| `url`     | Yes      | Base URL reachable from Kokpit, including protocol and optional port; Kokpit appends `/graphql` |
| `api_key` | Yes      | Dedicated key with read access to `ARRAY` and `VARS`; paste only the key |


**Displayed stats:**


| Stat   | Description                                                  |
| ------ | -------------------------------------------------------------- |
| Array  | Current array state (started, stopped, etc.)                  |
| Used   | Used / total array storage, with percentage                   |
| Disks  | Number of data disks in the array                              |
| Errors | Disks reporting an error status                                |
| Parity | Reported parity status and date; “—” when unavailable |
| Parity Errors | Reported parity error count; “—” when unavailable |


---

### Tdarr

Displays transcoding queue status, worker activity, and storage savings from Tdarr.

**Prerequisites:** A reachable Tdarr Server API. New Tdarr v3 installations enable authentication by default. Open the WebUI (normally port 8265), complete initial account setup if prompted and sign in as an administrator when authentication is enabled. Open **Tools → API Keys**, create a key for Kokpit and copy its full value, including any `tapi_` prefix. The `apikey` field is required when Server authentication is enabled; omit it only for a Server that already has authentication disabled. Keep keys private and use private networking or HTTPS.

Add/Edit Service includes a numbered guide, field help, troubleshooting and the shared outdated-instructions/GitHub-issue notice. Use the **Server API** address, normally port **8266**, in the integration URL; the optional tile launch URL can open the WebUI on **8265**. Kokpit retains any proxy prefix, normalizes a final slash and appends its `/api/v2` routes. Do not enter an API suffix or query string. It sends the key in `x-api-key`. Use **Test connection** when enabled, then save; otherwise save and check the dashboard. See the official [authentication guide](https://docs.tdarr.io/docs/other/authentication/), [API documentation](https://docs.tdarr.io/docs/api/) and [configuration variables](https://docs.tdarr.io/docs/installation/variables/).

#### `tdarr-stats`

New tiles default to a compact **3×2** summary. Choose a footprint in the service editor to show more detail:

| Footprint | Stats |
| --- | --- |
| Compact (3×2) | Transcode Queue, Workers |
| Wide (6×2) | Transcode Queue, Workers, Space Saved |
| Detailed (3×4) | Transcode Queue / Health Checks, Errored / Space Saved, Workers / FPS |

The detailed view keeps all six measurements. Positive queue counts are amber, errors red, storage savings and active workers green, and FPS blue. Zero queue/problem counts and inactive or unavailable activity are neutral. Storage savings use signed decimal KB/MB/GB/TB units; FPS uses one decimal place. Successful data remains visible with a refresh warning if polling fails.

Existing configurations without geometry, or with unsupported legacy sizes/footprints, retain a 6×2 wide summary; supported explicit footprints are preserved. Worker/FPS data remains best-effort and defaults to zero when the optional nodes request fails.

```yaml
services:
  - id: 10000000-0000-4000-8000-000000000034
    name: Tdarr
    launch_url: http://192.168.1.10:8265
    icon: tdarr
    integration:
      type: tdarr
      config:
        url: http://192.168.1.10:8266
        apikey: tapi_YOUR_API_KEY
service_tiles:
  - id: 20000000-0000-4000-8000-000000000034
    service_id: 10000000-0000-4000-8000-000000000034
    widget:
      type: tdarr-stats
```


| Field    | Required | Description                                                      |
| -------- | -------- | ---------------------------------------------------------------- |
| `url`    | Yes      | Tdarr Server API base URL, including protocol and Server port (normally 8266), reachable from Kokpit; retain any proxy prefix and omit `/api/v2` |
| `apikey` | When Server auth is enabled | Full API key from Tools → API Keys. New v3 installs need it. A saved value is retained until replaced or explicitly removed with Clear saved credential |


**Displayed stats:**


| Stat                | Description                                             |
| ------------------- | ------------------------------------------------------- |
| Transcode Queue     | Number of items in the transcode queue                  |
| Health Checks       | Number of items in the health checks queue              |
| Errored             | Number of items that encountered errors                 |
| Space Saved         | Total storage saved through transcoding, reported in GB and formatted for display |
| Workers             | Number of worker records returned by the nodes API; unavailable node data shows zero |
| FPS                 | Sum of reported worker FPS, rounded to one decimal; unavailable node data shows zero |

The default refresh is 10 seconds; editor overrides use milliseconds with a 5-second minimum. Queue/statistics data comes from the API v2 statistics document; missing counters default to zero. The nodes request is independent and best-effort. Check **Tools → API Docs** for your installed version if values differ; configuring Kokpit's key does not configure authentication on Tdarr Nodes.


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

New editor tiles use size-based statistics: Compact 3×2 shows To Assign and Remaining; Wide 6×2 adds Spent; Detailed 3×4 shows all six figures (To Assign, Budgeted, Spent, Remaining, Overspent and Net Worth). Existing configurations keep all six figures and their saved geometry. Enable **Choose stats by tile size** (`size_defaults: true`) to adopt the new defaults; leaving it off retains all six at every size. Amounts preserve currency/locale and negative signs, with the same privacy reveal on hover or keyboard focus.

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
| `actualbudget-summary` | `size_defaults` | bool | Show 2/3/6 figures by tile size (new editor presets: `true`; existing/YAML configurations: `false`). |
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
| `actualbudget-categories` | Category name/group, Spent / Available amounts with usage bar, colour status — mutually exclusive: green under 85% spent, yellow 85–100% spent, red when the category is overspent (balance below zero, which takes priority over the percentage). Sorted by % spent descending. |
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

**Sizes:** New tiles created in the editor show CPU/Memory in Compact (3x2), add Disk in Wide (6x2), and show all six fields in Detailed (3x4). Compact cards show usage percentages; focus or hover a memory/disk value for used/total and available capacity; Escape closes the details. Long details scroll with the mouse or Arrow/Page/Home/End keys while the value is focused. Existing tiles retain their saved fields and historical four-field defaults. Saved supported footprints remain as configured, including short canvases with historical or custom fields, which use keyboard-accessible scrolling. An explicit `fields` list overrides the size defaults, including an empty list. In the editor, **Use default fields** removes a custom selection; **Choose default fields by tile size** switches between size-based and historical defaults.

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
| `docker_socket_path` | No       | Docker socket for the container overview. Defaults to `KOKPIT_DOCKER_SOCKET`, then `/var/run/docker.sock`. Only used when Docker is selected explicitly or by the Detailed size default. |
| `fields`             | No       | Explicit stats to display: any of `cpu`, `memory`, `disk`, `network`, `load`, `docker`. Overrides size defaults. Without `size_defaults`, the default remains `cpu, memory, disk, network`. |
| `size_defaults`      | No       | Use 2/3/6 default fields according to the tile footprint when `fields` is absent. New editor tiles set this to `true`; omitted or `false` preserves historical defaults. |


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
