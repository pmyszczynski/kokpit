# CLAUDE.md

> This file is automatically read by Claude Code on every session.
> Keep it as a concise briefing. Full detail lives in `docs/`.

---

## Project Overview

A self-hosted personal dashboard / homepage — a modern alternative to Homepage, Homarr, Dashy, and Heimdall.

**Core goal:** The ultimate configurable homepage for a homelab or personal server. Beautiful by default, infinitely tweakable, secure enough to expose to the internet.

**Key differentiators from existing tools:**
- Dual-config: everything controllable both from a visual in-app UI **and** a `settings.yaml` file (they stay in sync)
- Built-in authentication — no reliance on external reverse proxies for basic protection
- First-class widget/integration system with a clean plugin-like API
- Modern, polished default theme with deep CSS variable support for personalization

---

## Tech Stack

- **Framework:** Next.js 15.x (App Router)
- **Styling:** CSS custom properties (`[data-theme]` attribute) + Tailwind utility layer
- **Config:** YAML (`settings.yaml` at project root / config dir)
- **Auth:** Built-in credential auth (bcrypt), JWT session tokens, optional TOTP 2FA
- **Deployment:** Docker + Docker Compose (primary), build-from-source as fallback
- **Database:** SQLite (better-sqlite3) for user/session state; YAML remains source of truth for layout/config
- **Testing:** Vitest + Testing Library (jsdom)

---

## Non-Negotiables

1. **Auth before external exposure** — the auth system must be complete and hardened before any feature that touches external network access.
2. **YAML ↔ UI sync** — any change made in the UI must reflect in `settings.yaml` and vice versa. These are never out of sync.
3. **No required cloud dependencies** — fully air-gappable. External APIs (weather, etc.) are opt-in widgets only.
4. **Docker-first** — primary deployment target is Docker Compose. Everything must work containerized.
5. **Custom CSS always wins** — users can inject arbitrary CSS and it must override everything without `!important` hacks.

---

## Current Focus

> Manually update this as you move through phases.

**Active phase:** Phase 1 — Foundation
**Current task:** Service tiles (app links)

---

## Project Structure

```
/
├── Claude.md               ← you are here
├── settings.yaml           ← user config (layout, services, widgets, auth)
├── docker-compose.yml
├── docs/
│   ├── Roadmap.md          ← full prioritized task list
│   └── plans/              ← implementation plans
├── src/
│   ├── app/                ← Next.js App Router (pages, API routes)
│   ├── auth/               ← auth system (users, JWT, sessions, bcrypt)
│   ├── components/         ← shared React components (Navbar, etc.)
│   ├── config/             ← YAML parser, schema, validator, theme helper
│   ├── integrations/       ← per-service integration modules (stub)
│   ├── test/               ← Vitest setup
│   └── widgets/            ← widget plugin system (stub)
└── public/
    └── icons/              ← bundled icon sets
```

---

## Key References

- **Full roadmap & task list:** [`docs/Roadmap.md`](docs/Roadmap.md)
- **Architecture decisions:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) *(not yet created)*
- **Widget/integration specs:** [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) *(create in Phase 2)*

---

## Comparable Projects (for research)

| Project | Strength | Weakness |
|---|---|---|
| [Homepage](https://github.com/benphelps/homepage) | 100+ integrations, YAML-driven | No visual editor, no built-in auth |
| [Homarr](https://github.com/ajnart/homarr) | Drag-and-drop UI, modern | Config not fully YAML-portable |
| [Dashy](https://github.com/Lissy93/dashy) | Highly customizable, widget-rich | Config-heavy, complex setup |
| [Heimdall](https://github.com/linuxserver/Heimdall) | Simple, pretty | Limited, no real widget system |
