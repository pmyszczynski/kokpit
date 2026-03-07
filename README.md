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
- [ ] In-app settings panel

**Phase 2 — Integrations & Widgets**
- [ ] Widget system architecture
- [ ] Tier-1 self-hosted integrations (Jellyfin, *arr stack, Pi-hole, Portainer, Proxmox, …)
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
