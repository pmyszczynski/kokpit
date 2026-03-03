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

> Update this section once decisions are locked in.

- **Framework:** TBD (Next.js / SvelteKit preferred candidates)
- **Styling:** CSS variables + optional Tailwind utility layer
- **Config:** YAML (`settings.yaml` at project root / config dir)
- **Auth:** Built-in credential auth (bcrypt), session tokens, optional 2FA
- **Deployment:** Docker + Docker Compose (primary), build-from-source as fallback
- **Database:** TBD — likely SQLite for user/session state; YAML remains source of truth for layout/config

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
**Current task:** Project scaffold & tech stack

---

## Project Structure (target)

```
/
├── CLAUDE.md               ← you are here
├── settings.yaml           ← user config (layout, services, widgets, auth)
├── docker-compose.yml
├── docs/
│   ├── ROADMAP.md          ← full prioritized task list
│   ├── ARCHITECTURE.md     ← tech decisions, folder structure, ADRs
│   └── INTEGRATIONS.md     ← widget/integration specs
├── src/
│   ├── app/                ← UI (pages, components)
│   ├── config/             ← YAML parser, schema, validator
│   ├── auth/               ← auth system
│   ├── widgets/            ← widget plugin system
│   └── integrations/       ← per-service integration modules
└── public/
    └── icons/              ← bundled icon sets
```

---

## Key References

- **Full roadmap & task list:** [`docs/ROADMAP.md`](docs/ROADMAP.md)
- **Architecture decisions:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) *(create as decisions are made)*
- **Widget/integration specs:** [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) *(create in Phase 2)*

---

## Comparable Projects (for research)

| Project | Strength | Weakness |
|---|---|---|
| [Homepage](https://github.com/benphelps/homepage) | 100+ integrations, YAML-driven | No visual editor, no built-in auth |
| [Homarr](https://github.com/ajnart/homarr) | Drag-and-drop UI, modern | Config not fully YAML-portable |
| [Dashy](https://github.com/Lissy93/dashy) | Highly customizable, widget-rich | Config-heavy, complex setup |
| [Heimdall](https://github.com/linuxserver/Heimdall) | Simple, pretty | Limited, no real widget system |