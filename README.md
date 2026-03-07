# kokpit

A self-hosted homelab dashboard built with Next.js. Kokpit gives you a single place to access all your self-hosted services, with live status indicators, system widgets, and a fully YAML-driven configuration — no database config required.

## What it does

Kokpit is a personal dashboard for homelab and self-hosted setups. You define your services, widgets, and layout in a single `settings.yaml` file, and Kokpit renders a clean, themeable dashboard accessible from any browser.

**Current capabilities (Phase 1):**
- Secure username/password authentication with bcrypt and session cookies
- YAML-driven configuration with hot-reload in dev mode
- Themeable UI (dark/light/OLED/high-contrast) with custom CSS injection
- Grid-based layout canvas, configurable columns and row height

**Coming soon:** clickable service tiles with status pings, live widgets (system stats, weather, RSS), drag-and-drop layout editor, Docker auto-discovery, and more — see [`docs/Roadmap.md`](docs/Roadmap.md).

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

All configuration lives in `settings.yaml` at the project root. The in-app UI reads from and writes back to this file.

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

## Contributing

Contributions are welcome. Please open an issue first to discuss significant changes before sending a pull request.

- **Bug reports & feature requests:** open a GitHub issue
- **Pull requests:** branch from `main`, keep changes focused, and make sure `npm run lint`, `npm run type-check`, and `npm test` all pass before submitting
- Follow the existing code style — ESLint and TypeScript strict mode are enforced in CI

## License

MIT — see [LICENSE](LICENSE) for details.
