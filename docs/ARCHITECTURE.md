# Architecture

Kokpit is a Docker-first Next.js dashboard. `settings.yaml` is the source of
truth for dashboard configuration; SQLite holds only account state. The server
owns configuration I/O, credentials, and upstream integration requests. Client
components receive safe projections and render the dashboard and editor.

## System overview

```text
settings.yaml ──► config loader/schema ──► server-rendered dashboard
     ▲                    │                         │
     │                    ├──► client-safe settings ─┼──► settings/edit UI
     │                    │                         │
     └──── authenticated PATCH /api/settings ◄──────┘

SQLite users.db ──► auth/session ──► protected routes and API guards

service integration config + tile widget options
        └──► /api/widget (server-side fetch) ──► browser widget polling
```

## Runtime and routing

The application uses the Next.js App Router.

- [`src/instrumentation.ts`](../src/instrumentation.ts) loads the Node-only
  instrumentation module at startup. It validates configuration and starts the
  file watcher.
- [`src/app/layout.tsx`](../src/app/layout.tsx) loads the theme and global
  appearance before rendering the application.
- [`src/app/(protected)`](../src/app/(protected)) contains the dashboard and
  settings experience. Its layout redirects unauthenticated visitors to login
  and redirects to the setup wizard when authentication is enabled but no users
  exist.
- Public routes are deliberately limited to flows such as login, setup, password
  recovery, and health checks. API routes enforce the same auth decision through
  `isRequestAuthenticated()` when their data or operation is protected.

Server components render the normal dashboard. Client components handle the
settings panel, edit mode, drag-and-drop, and widget refresh UI. Keep Node-only
configuration code out of client imports: shared config types and pure helpers
live in `src/config/index.ts`, while filesystem and locking APIs are exported
from `src/config/server.ts`.

## Configuration and persistence

`src/config/schema.ts` defines schema version 2. The core model separates
reusable services from their dashboard placements:

- `services[]` contains identity, launch metadata, and an optional integration
  connection.
- `service_tiles[]` references a service and owns group, size, widget type, and
  per-tile widget options.
- `groups[]`, `bookmarks[]`, `appearance`, `layout`, and `auth` complete the
  dashboard configuration.

The loader in `src/config/loader.ts` validates the YAML, migrates legacy service
shapes to schema version 2, and writes configuration under an inter-process
lock. Writes are installed atomically and use a revision value to reject an edit
that would overwrite an external change. The watcher invalidates the cached
configuration after on-disk edits.

Persistence locations are environment-configurable:

| Purpose | Environment variable | Source/local default | Production image default |
| --- | --- | --- | --- |
| Dashboard configuration | `KOKPIT_CONFIG_PATH` | `settings.yaml` | `/data/settings.yaml` |
| Users and recovery state | `KOKPIT_DB_PATH` | `data/users.db` | `/data/users.db` |
| Icon and background uploads | `KOKPIT_UPLOADS_PATH` | `data/uploads` | `/data/uploads` |

The production image uses `/data` as its default persistent location; the
quick-start Compose configuration mounts that directory from the host. Uploaded
assets are hash-addressed below that directory; their upload routes validate
file type and sanitize SVGs.

## Authentication and authorization

Users live in SQLite (`src/auth/db.ts`) with bcrypt password hashes, optional
TOTP secrets, and recovery-code state. Sessions are HS256 JWTs in an `httpOnly`,
same-site cookie. `auth.session_ttl_hours` sets both token and cookie lifetime.

`KOKPIT_SESSION_SECRET` supplies the signing key. If it is absent, Kokpit
creates a random key and stores it next to the database so sessions survive a
restart. `KOKPIT_AUTH_DISABLED=true` is an explicit trusted-network bypass and
overrides `auth.enabled`; it must not be used for an internet-exposed instance.
`KOKPIT_INSECURE_COOKIE=true` is only for local HTTP testing: it removes the
secure-cookie flag in production mode.

There are no roles yet. An authenticated user can edit configuration, and the
same is true for any visitor when authentication is disabled.

## Widgets and integrations

Widgets are registered by side effect when `src/integrations/index.ts` imports
each integration module. The registry in `src/widgets/index.ts` defines:

- an integration: connection schema, form fields, credential scope, and optional
  connection test;
- a widget: merged config schema, per-tile options, data fetcher, renderer,
  refresh interval, and size hints.

At runtime, `ServiceGrid` resolves a service tile to a widget without sending
its configuration to the page. The browser polls `/api/widget` with the tile ID.
That route retrieves the saved service connection and tile options, validates
both against the registered schemas, combines them only on the server, applies a
hard timeout, and calls the integration fetcher. This keeps API keys, tokens,
and passwords out of browser network requests and component props.

The settings API uses `src/widgets/configSecrets.ts` to make a client-safe
projection. Registered password fields are replaced with signed references;
unknown or unsafe config is represented by an opaque reference. On save, the
server verifies those references before retaining an existing secret. This lets
the editor preserve credentials without disclosing them.

To add an integration, create its API client and widget renderer under
`src/integrations/<name>/`, register its integration and widget definitions,
import it from `src/integrations/index.ts`, add tests, and document its YAML
fields in the README's Widgets section.

## Dashboard rendering and editing

`src/components/ServiceGrid.tsx` resolves group order, tile sizes, bookmark
placement, and invalid widget configuration for the server-rendered dashboard.
The edit-mode components under `src/components/edit/` stage changes locally.
Save submits all changed top-level configuration sections through
`PATCH /api/settings` with the revision header; discard leaves `settings.yaml`
unchanged. Tile and group drag-and-drop therefore do not mutate persisted
configuration until the user explicitly saves.

Appearance is resolved server-side before the initial render. Custom CSS from
`appearance.custom_css` is escaped to prevent a style-tag breakout and emitted
in the `user-custom` cascade layer, which follows integration-specific layers.

## Deployment and operations

The Dockerfile builds Next.js standalone output, then runs it in a Node 22
Alpine image as a non-root user. `docker-entrypoint.sh` creates `/data` and, when
present, adds that user to the Docker socket's group for the Docker widget. The
socket remains a high-privilege host interface despite a read-only mount; see
the README before enabling it.

`docker-compose.yml` provides `kokpit-dev` for hot reload and `kokpit` for the
production runner. `/api/health` is unauthenticated so Docker and monitoring
tools can use it for health checks.

## Testing and delivery

Unit tests live under `src/__tests__`. Playwright covers the normal dashboard,
visual regressions, and authentication flows under `e2e/`. CI runs lint,
type-check, and unit tests separately, while its E2E job runs standard E2E then
production-auth E2E. Release automation first runs the full test gate, then
creates a GitHub release and calls the reusable Docker publish workflow, which
publishes and verifies the expected GHCR manifests.

See [TESTING.md](TESTING.md) for test commands and visual-baseline guidance, and
[DOCKER_RELEASES.md](DOCKER_RELEASES.md) for the release procedure.
