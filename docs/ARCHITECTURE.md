# Architecture

Kokpit is a Docker-first Next.js dashboard. `settings.yaml` is the source of
truth for dashboard configuration. SQLite persists account and session state;
it does not hold dashboard configuration. Server code owns configuration I/O,
credentials, and upstream integration requests. Browser components receive a
safe settings projection and render the dashboard and editor.

## System overview

```text
settings.yaml ──► config loader/schema ──► protected dashboard
     ▲                    │                         │
     │                    ├──► safe settings API ───┼──► settings editor
     │                    │                         │
     └──── authenticated PATCH /api/settings ◄──────┘

SQLite users.db ──► opaque session lookup ──► route and API guards

service integration config + tile widget options
        └──► /api/widget (server-side fetch) ──► browser widget polling
```

## Runtime and routing

The application uses the Next.js App Router.

- [`src/instrumentation.ts`](../src/instrumentation.ts) loads the Node-only
  instrumentation module at runtime, outside production builds. That module
  validates configuration and starts the file watcher.
- [`src/app/layout.tsx`](../src/app/layout.tsx) loads the configured theme and
  appearance before rendering the application.
- [`src/app/(protected)`](../src/app/(protected)) contains the dashboard and
  settings experience. Its layout sends unauthenticated visitors to login and
  sends visitors to setup when authentication is enabled but no users exist.
- Login, setup, password recovery, and `/api/health` are public. Protected API
  routes use `isRequestAuthenticated()` before returning or changing data.

Server components render the dashboard. Client components run the settings
panel, edit mode, drag-and-drop, and widget refresh UI. Keep Node-only
configuration code out of client imports: shared config types and pure helpers
live in `src/config/`, while filesystem and locking APIs are exposed through
`src/config/server.ts`.

## Configuration and persistence

`src/config/schema.ts` defines schema version 2. The core model separates
reusable services from their dashboard placements:

- `services[]` contains identity, launch metadata, and an optional integration
  connection.
- `service_tiles[]` references a service and owns its group, footprint, widget
  type, and widget-specific options.
- `groups[]`, `bookmarks[]`, `appearance`, `layout`, and `auth` complete the
  dashboard configuration.

The loader in `src/config/loader.ts` validates YAML, migrates supported legacy
shapes, and writes under an inter-process lock. Configuration writes are
installed atomically and compare a source revision so an editor cannot silently
overwrite an external change. The watcher invalidates the cache after on-disk
edits; routes return a conflict while a replacement file is incomplete.

Persistence locations are environment-configurable:

| Purpose | Environment variable | Source/local default | Production image default |
| --- | --- | --- | --- |
| Dashboard configuration | `KOKPIT_CONFIG_PATH` | `settings.yaml` | `/data/settings.yaml` |
| Users and sessions | `KOKPIT_DB_PATH` | `data/users.db` | `/data/users.db` |
| Icon and background uploads | `KOKPIT_UPLOADS_PATH` | `data/uploads` | `/data/uploads` |

The production image uses `/data` as its persistent location and the quick-start
Compose configuration mounts that directory from the host. Uploaded assets are
stored beneath the uploads directory; upload routes validate file types and
sanitize SVGs.

## Authentication and authorization

Users live in SQLite (`src/auth/db.ts`) with bcrypt password hashes, optional
TOTP secrets, recovery-code state, and a per-user session version. Login
creates a random opaque session token, stores only its SHA-256 hash in the
`sessions` table, and sends the raw token in the `httpOnly`, same-site `session`
cookie. Sessions can be listed and revoked. Their server-side idle timeout is
configured with `auth.session_idle_timeout_hours`; `0` means no idle expiry.

JWTs are used only for five-minute TOTP challenges. `KOKPIT_SESSION_SECRET`
signs those challenges and other server-side signed values. When it is absent,
Kokpit persists a generated secret beside the database. `KOKPIT_AUTH_DISABLED=true`
overrides `auth.enabled` for a trusted network. `KOKPIT_INSECURE_COOKIE=true`
removes the production secure-cookie flag for local HTTP testing.

There are no roles yet. A signed-in user can edit configuration; when
authentication is disabled, visitors can do the same.

## Widgets and integrations

`src/integrations/index.ts` registers integration modules, and
`src/widgets/index.ts` holds their definitions. An integration describes its
connection schema and editor fields; a widget describes its option schema,
fetcher, renderer, refresh behavior, and supported footprints.

`/api/widget` resolves a tile ID to its saved service connection and tile
options, validates them, combines them only on the server, applies the widget's
hard timeout, and calls its fetcher. The browser receives widget data, never
the connection credentials.

`/api/settings` returns a client-safe settings projection. Registry-declared
credential fields are represented by signed references so the editor can retain
an existing credential without reading it. The server verifies those references
when a settings update is saved.

To add an integration, create its API client and widget renderer under
`src/integrations/<name>/`, register its definitions, import it from
`src/integrations/index.ts`, add tests, and document its YAML fields in the
README Widgets section.

## Dashboard rendering and editing

`ServiceGrid` resolves group order, tile placement, bookmark placement, and
invalid widget configuration for the dashboard. Edit-mode components under
`src/components/edit/` stage changes locally. Save sends changed top-level
configuration sections through `PATCH /api/settings` with `If-Match`; discard
leaves `settings.yaml` unchanged. Tile and group drag-and-drop do not persist
until the user saves.

Appearance is resolved server-side for the first render. Sanitized
`appearance.custom_css` is emitted in the `user-custom` cascade layer, which
is declared after the application layers so user CSS can override them.

## Deployment and operations

The Dockerfile builds Next.js standalone output, then runs it in a Node 22
Alpine image as a non-root user. `docker-entrypoint.sh` creates `/data` and,
when a Docker socket is mounted, adds the runtime user to its owning group. The
Docker socket remains a high-privilege host interface even when mounted read-only.

`docker-compose.yml` provides `kokpit-dev` for hot reload and `kokpit` for the
production runner. `/api/health` is intentionally unauthenticated for Docker
and monitoring health checks.

## Testing and delivery

Unit tests live under `src/__tests__`; Playwright covers dashboard, visual, and
authentication flows under `e2e/`. CI runs lint, type-check, and unit tests as
separate jobs, then runs normal and production-auth E2E suites. Release
automation runs the full gate, creates a GitHub release, and invokes the Docker
publish workflow, which publishes and verifies the expected GHCR manifests.

See [TESTING.md](TESTING.md) for local validation and visual-baseline guidance,
and [DOCKER_RELEASES.md](DOCKER_RELEASES.md) for the release procedure.
