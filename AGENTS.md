# AGENTS.md

> This file is automatically read by Codex on every session.
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

**Active phase:** Phase 2 — Integrations & Widgets
**Current task:** Remaining Phase 2 P0s: Tdarr integration

---

## Project Structure

```
/
├── AGENTS.md               ← you are here
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
│   ├── integrations/       ← per-service integration modules (Plex, *arr apps, qBittorrent, SABnzbd, Seerr, Immich, Netdata, Unraid, Docker)
│   ├── test/               ← Vitest setup
│   └── widgets/            ← widget plugin system (registry + shared widget types)
└── public/
    └── icons/              ← bundled icon sets
```

---

## CI on Pull Requests

`.github/workflows/ci.yml` (Lint, Type-check, Unit tests, E2E) triggers on a bare
`pull_request:`, which means the default activity types — `opened`, `synchronize`,
`reopened`. Two consequences bite in practice:

**Draft status is *not* why CI is missing.** GitHub runs Actions on draft PRs by
default; there is no repository setting to disable it, and `ci.yml` has no
`if: github.event.pull_request.draft == false` gate. If you don't see CI on a
draft PR, draft status is not the cause — look for one of the reasons below.
([events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows),
[community #25722](https://github.com/orgs/community/discussions/25722))

**Un-drafting alone never starts CI.** `ready_for_review` is not one of the
default activity types and is not listed in `ci.yml`, so marking a PR "Ready for
review" fires an event no workflow listens for. Don't wait on it.

**A PR opened via the API/MCP may produce no run at all.** Events authored by
`GITHUB_TOKEN` do not create workflow runs (the same anti-recursion rule already
documented under Release Process below), and this repo deliberately does not
permit Actions to create or approve its own PRs. Observed on PR #71: opening it
through `mcp__github__create_pull_request` produced **zero** `ci.yml` runs — not
queued, not `action_required` — while GitHub-managed default-setup CodeQL and the
GitGuardian app still reported. Pushing a commit afterwards fired `synchronize`
and the full suite ran green.
([GITHUB_TOKEN docs](https://docs.github.com/en/actions/concepts/security/github_token),
[community #65321](https://github.com/orgs/community/discussions/65321))

**Practical rule:** after opening a PR programmatically, do not assume CI ran.
Check `mcp__github__pull_request_read` with `method: get_check_runs` against the
PR — that is the authoritative view. (`list_workflow_runs` filtered by branch has
returned `total_count: 0` for runs that existed; don't diagnose from it.) If the
`ci.yml` jobs are absent, push a commit to trigger `synchronize` rather than
toggling draft state. Local `npm run lint && npm run type-check && npm test`
covers three of the four jobs, but **not E2E** — only CI runs Playwright, so a
green local gate is not a substitute for a CI run.

---

## Release Process

`main` has a branch ruleset requiring all changes go through a PR, and GitHub Actions is deliberately **not** permitted to create/approve its own PRs in this repo (a security setting, left off on purpose — enabling it would let any workflow self-merge unreviewed changes). This means the version bump can't happen inside CI; it has to be merged as a normal PR first. When asked to cut a release, do this:

1. **Pick the version** (semver). Check the latest tag/release and the commits since it to decide patch/minor/major.
2. **Bump the version on `main` via a PR** (Actions can't do this step, so do it directly):
   - Create a branch off `main`, run `npm version <version> --no-git-tag-version`, commit `package.json` + `package-lock.json`, push.
   - Open a PR into `main` (`mcp__github__create_pull_request`) and merge it (`mcp__github__merge_pull_request`, squash).
3. **Trigger the release workflow**: `mcp__github__actions_run_trigger`, method `run_workflow`, `workflow_id: release.yml`, `ref: main`, `inputs: {"version": "<version>"}`. It runs the full test gate (lint, type-check, unit, E2E), checks `package.json` matches the input version, tags `vX.Y.Z`, and creates the GitHub Release.
4. **Docker publish**: `release.yml`'s last step explicitly dispatches `.github/workflows/publish.yml` (`gh workflow run publish.yml -f tag=vX.Y.Z`) rather than relying on the `release: published` event — GitHub suppresses events authored by `GITHUB_TOKEN` to prevent recursive workflow runs, so the release `release.yml` creates would never auto-trigger `publish.yml` otherwise. (Releases made by an actual human via the GitHub UI still trigger it normally through the `release` event.)
5. **Verify**: check the release workflow run, the new tag/release, and that the publish workflow run for the new tag succeeded (`mcp__github__actions_list`, `mcp__github__list_releases`).

If `release.yml`'s "Verify package.json version matches input" step fails, it means step 2 was skipped or used the wrong version — fix the PR, then re-run.

---

## Key References

- **Full roadmap & task list:** [`docs/Roadmap.md`](docs/Roadmap.md)
- **Architecture decisions:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) *(not yet created)*
- **Widget/integration specs:** documented per-widget in [`README.md § Widgets`](README.md#widgets) rather than a separate file — add new widgets there

---

## Comparable Projects (for research)

| Project | Strength | Weakness |
|---|---|---|
| [Homepage](https://github.com/benphelps/homepage) | 100+ integrations, YAML-driven | No visual editor, no built-in auth |
| [Homarr](https://github.com/ajnart/homarr) | Drag-and-drop UI, modern | Config not fully YAML-portable |
| [Dashy](https://github.com/Lissy93/dashy) | Highly customizable, widget-rich | Config-heavy, complex setup |
| [Heimdall](https://github.com/linuxserver/Heimdall) | Simple, pretty | Limited, no real widget system |
